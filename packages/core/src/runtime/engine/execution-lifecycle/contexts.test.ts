import { describe, expect, it, vi } from 'vitest';
import { createDatabaseAsync } from '../../../store/db.js';
import { WorkflowStore } from '../../../store/workflow-store.js';
import { WorkflowRuntime } from '../../engine.js';
import type { ArtifactSink } from '../../../modules/types.js';
import { createTestConnectors } from '../../../modules/test-connectors.js';

describe('runtime execution contexts', () => {
  it('injects the generated-artifact sink into fresh and approval-resumed contexts', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
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
    const runtime = new WorkflowRuntime({
      store,
      globalActive: true,
      workflowActive: {},
      artifactSink,
      connectors: {
        document: {
          name: 'document',
          execute: async (_action, _params, ctx) => {
            observedSinks.push(ctx.artifactSink);
            return { ok: true, data: { observed: true } };
          },
        },
        gmail: {
          name: 'gmail',
          execute: async (_action, _params, ctx) => {
            observedSinks.push(ctx.artifactSink);
            return { ok: true, data: { observed: true } };
          },
        },
      },
    });

    const first = await runtime.executeWorkflow({
      name: 'PDF sink injection',
      goal: 'fresh and resumed contexts share the host-owned artifact sink',
      version: 1,
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
    }, { ephemeral: true });

    expect(first.status).toBe('pending_approval');
    expect(observedSinks).toEqual([artifactSink]);

    const resumed = await runtime.continueAfterApproval(first.pendingApprovalId!);

    expect(resumed.status).toBe('success');
    expect(observedSinks).toEqual([artifactSink, artifactSink]);
  });

  it('replaces and removes live connectors without restarting the runtime', async () => {
    const store = new WorkflowStore(await createDatabaseAsync(':memory:'));
    const runtime = new WorkflowRuntime({ store, globalActive: true, workflowActive: {}, connectors: {} });
    const connector = { name: 'dynamic', execute: async () => ({ ok: true, data: {} }) };

    runtime.setConnector('dynamic', connector);
    expect(runtime.connectors.dynamic).toBe(connector);

    runtime.setConnector('dynamic', null);
    expect(runtime.connectors.dynamic).toBeUndefined();
  });
});
