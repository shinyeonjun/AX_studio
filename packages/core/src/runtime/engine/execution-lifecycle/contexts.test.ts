import { describe, expect, it, vi } from 'vitest';
import { createDatabaseAsync } from '../../../persistence/db.js';
import { WorkflowStore } from '../../../persistence/workflow-store.js';
import { WorkflowRuntime } from '../../engine.js';
import type { ArtifactSink } from '../../../connectors/types.js';
import type { MessageToolDraft } from '../../../contracts/tool-result.js';

describe('runtime execution contexts', () => {
  it('injects the generated-artifact sink into fresh and approval-resumed contexts', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const session = store.saveWorkspaceChat({ messages: [{ role: 'user', content: 'Synthetic artifact context fixture' }] });
    store.setConnection('gmail', true);
    const artifactSink: ArtifactSink = {
      putBytes: vi.fn(() => ({
        id: 'unused',
        sha256: 'unused',
        fileName: 'unused.pdf',
        size: 0,
        createdAt: '2026-08-31T00:00:00.000Z',
      })),
    };
    const observedSinks: Array<ArtifactSink | undefined> = [];
    const observedSessions: Array<string | undefined> = [];
    const runtime = new WorkflowRuntime({
      store,
      globalActive: true,
      artifactSink,
      connectors: {
        document: {
          name: 'document',
          execute: async (_action, _params, ctx) => {
            observedSinks.push(ctx.artifactSink);
            observedSessions.push(ctx.workspaceSessionId);
            return { ok: true, data: { observed: true } };
          },
        },
        gmail: {
          name: 'gmail',
          prepareMessageSend: vi.fn(async (draft: MessageToolDraft) => {
            expect(draft).toEqual({ tool: 'gmail', to: 'test@example.com', subject: '', body: 'approved' });
            return { provider: 'gmail' as const, accountId: 'sender@example.test', accountLabel: 'Synthetic sender',
              destinationId: 'test@example.com', destinationLabel: 'test@example.com' };
          }),
          execute: async (_action, _params, ctx) => {
            observedSinks.push(ctx.artifactSink);
            observedSessions.push(ctx.workspaceSessionId);
            return { ok: true, data: { observed: true, id: 'synthetic-context-receipt' } };
          },
        },
      },
    });

    const first = await runtime.executeWorkflow({
      name: 'PDF sink injection',
      goal: 'fresh and resumed contexts share the host-owned artifact sink',
      version: 1,
      inputs: [],
      steps: [
        {
          type: 'action',
          id: 'render',
          connector: 'document',
          action: 'html.render',
          actionRef: 'document.html.render',
          params: {},
          sideEffect: 'REVERSIBLE',
        },
        {
          type: 'human_approval',
          id: 'approve_pdf',
          reason: 'PDF 생성 승인',
          forActionIds: ['send'],
        },
        {
          type: 'action',
          id: 'send',
          connector: 'gmail',
          action: 'message.send',
          actionRef: 'gmail.message.send',
          params: { to: 'test@example.com', body: 'approved' },
          sideEffect: 'EXTERNAL_HIGH',
        },
      ],
      permissions: {},
      approval: [],
      allowExternalAuto: true,
      assumptions: [],
      sideEffects: {},
      dataPolicy: {},
    }, { ephemeral: true, workspaceSessionId: session.id });

    expect(first.status).toBe('pending_approval');
    expect(observedSinks).toEqual([artifactSink]);
    expect(observedSessions).toEqual([session.id]);

    const approvalId = first.pendingApprovalId!;
    const unconfirmed = await runtime.continueAfterApproval(approvalId);
    expect(unconfirmed.errorCode).toBe('tool_result_confirmation_required');
    expect(store.getApproval(approvalId)?.status).toBe('pending');
    expect(observedSinks).toEqual([artifactSink]);

    const review = await runtime.reviewToolResult({ approvalId, workspaceSessionId: session.id, revision: 0 });
    expect(review.draft).toEqual({ tool: 'gmail', to: 'test@example.com', subject: '', body: 'approved' });
    const resumed = await runtime.continueAfterApproval(approvalId, review.confirmation);

    expect(resumed.status).toBe('success');
    expect(resumed.errorCode).toBeUndefined();
    expect(resumed.toolSendOutcome).toMatchObject({ status: 'sent', receiptId: 'synthetic-context-receipt' });
    expect(observedSinks).toEqual([artifactSink, artifactSink]);
    expect(observedSessions).toEqual([session.id, session.id]);
    expect((await runtime.continueAfterApproval(approvalId, review.confirmation)).status).toBe('failed');
    expect(observedSinks).toEqual([artifactSink, artifactSink]);
  });

  it('replaces and removes live connectors without restarting the runtime', async () => {
    const store = new WorkflowStore(await createDatabaseAsync(':memory:'));
    const runtime = new WorkflowRuntime({ store, globalActive: true, connectors: {} });
    const connector = { name: 'dynamic', execute: async () => ({ ok: true, data: {} }) };

    runtime.setConnector('dynamic', connector);
    expect(runtime.connectors.dynamic).toBe(connector);

    runtime.setConnector('dynamic', null);
    expect(runtime.connectors.dynamic).toBeUndefined();
  });
});
