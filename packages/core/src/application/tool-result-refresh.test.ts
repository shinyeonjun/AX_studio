import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import { createAxStudioCore } from './bootstrap.js';
import type { Connector, ExecutionLogEntry } from '../connectors/types.js';
import type { WorkflowIR } from '../workflow/schema.js';

vi.mock('../persistence/paths/app-log.js', () => ({ appendAppLog: vi.fn() }));

type Failure = 'projection' | 'workspace' | 'execution';
async function pending(tool: 'gmail' | 'slack' = 'gmail', failures: Failure[] = []) {
  let armed = false;
  const observed: string[] = [];
  const core = await createAxStudioCore({
    dataRoot: mkdtempSync(join(tmpdir(), 'ax-bootstrap-tool-refresh-')),
    dbPath: ':memory:',
    onWorkspaceChatChanged: () => {
      if (!armed) return;
      observed.push('workspace');
      if (failures.includes('workspace')) throw new Error('Synthetic workspace observer failure');
    },
    onExecutionFinished: () => {
      if (!armed) return;
      observed.push('execution');
      if (failures.includes('execution')) throw new Error('Synthetic execution observer failure');
    },
  });
  core.runtime.setGlobalActive(true);
  const session = core.store.saveWorkspaceChat({ messages: [{ role: 'user', content: 'Synthetic literal send' }] });
  core.store.setConnection(tool, true, { account: 'Unverified configuration label' });
  const sends: Array<{ params: Record<string, unknown>; literal: boolean }> = [];
  const connector: Connector = {
    name: tool,
    prepareMessageSend: async draft => {
      if (draft.tool !== tool) throw new Error('Synthetic provider mismatch');
      return draft.tool === 'gmail'
        ? { provider: 'gmail', accountId: 'verified@example.test', accountLabel: 'Verified fixture account',
          destinationId: draft.to, destinationLabel: draft.to }
        : { provider: 'slack', accountId: 'U12345678', accountLabel: 'Verified fixture bot',
          workspaceId: 'T12345678', workspaceLabel: 'Verified fixture workspace',
          destinationId: 'C12345678', destinationLabel: '#fixture' };
    },
    execute: async (_action, params, ctx) => {
      sends.push({ params: structuredClone(params), literal: ctx.literalMessage === true });
      return { ok: true, data: tool === 'gmail' ? { id: 'synthetic-bootstrap-receipt' }
        : { ts: '100.001', channel: 'C12345678' } };
    },
  };
  core.runtime.setConnector(tool, connector);
  const params = tool === 'gmail'
    ? { to: 'recipient@example.test', subject: 'Synthetic subject', body: 'Human-written body' }
    : { channel: '#fixture', text: 'Human-written message' };
  const workflow: WorkflowIR = {
    name: 'Synthetic bootstrap send', goal: 'Receipt and presentation warning', version: 1, inputs: [],
    steps: [{ type: 'action', id: 'send', connector: tool, action: 'message.send',
      sideEffect: tool === 'gmail' ? 'EXTERNAL_HIGH' : 'EXTERNAL', params }],
    permissions: {}, approval: [], allowExternalAuto: false, assumptions: [], sideEffects: {}, dataPolicy: {},
  };
  const result = await core.runtime.executeWorkflow(workflow, { ephemeral: true, workspaceSessionId: session.id });
  expect(result.status).toBe('pending_approval');
  const approvalId = result.pendingApprovalId!;
  const source = core.runtime.getToolResult(approvalId)!;
  const review = await core.runtime.reviewToolResult({ approvalId, workspaceSessionId: session.id, revision: source.revision });
  expect(core.store.getWorkspaceChat(session.id)?.messages.some(message => message.approval?.id === approvalId)).toBe(true);
  if (failures.includes('projection')) {
    vi.spyOn(core.store, 'upsertWorkspaceChatExecutionResult').mockImplementation(() => {
      observed.push('projection');
      throw new Error('Synthetic projection persistence failure');
    });
  }
  armed = true;
  return { core, session, sends, observed, approvalId, executionId: result.executionId, review, params, tool };
}

type Fixture = Awaited<ReturnType<typeof pending>>;
async function close(fixture: Fixture) {
  fixture.core.runtime.stopAccepting();
  await fixture.core.runtime.waitForIdle();
  fixture.core.db.close?.();
}
async function confirmOnce(fixture: Fixture, warning: boolean) {
  const { core, approvalId, review } = fixture;
  const outcomes = await Promise.all([
    core.runtime.continueAfterApproval(approvalId, review.confirmation),
    core.runtime.continueAfterApproval(approvalId, review.confirmation),
  ]);
  const successes = outcomes.filter(result => result.status === 'success');
  expect(successes).toHaveLength(1);
  const result = successes[0]!;
  expect(result.toolSendOutcome).toMatchObject({ status: 'sent', receiptId: fixture.tool === 'gmail' ? 'synthetic-bootstrap-receipt' : '100.001' });
  expect(result.refreshWarning === true).toBe(warning);
  const execution = core.store.getExecution(fixture.executionId)!;
  const log: ExecutionLogEntry[] = JSON.parse(execution.logJson ?? '[]');
  expect(result.log.filter(entry => entry.code === 'execution_refresh_failed')).toHaveLength(warning ? 1 : 0);
  expect(log.filter(entry => entry.code === 'execution_refresh_failed')).toHaveLength(warning ? 1 : 0);
  expect(execution.status).toBe('success');
  expect(core.store.getApproval(approvalId)?.status).toBe('approved');
  expect(core.runtime.getToolSendOutcome(approvalId)).toMatchObject({ status: 'sent', receiptId: result.toolSendOutcome!.receiptId });
  expect(fixture.sends).toEqual([{ params: fixture.tool === 'gmail' ? fixture.params
    : { channel: 'C12345678', text: 'Human-written message' }, literal: true }]);
  const later = await core.runtime.continueAfterApproval(approvalId, review.confirmation);
  expect(later.status).not.toBe('success');
  expect(fixture.sends).toHaveLength(1);
  expect(core.store.getExecution(fixture.executionId)?.status).toBe('success');
  expect(core.store.getApproval(approvalId)?.status).toBe('approved');
}

describe('real bootstrap tool result refresh warnings', () => {
  it.each((['gmail', 'slack'] as const).flatMap(tool =>
    (['projection', 'workspace', 'execution'] as const).map(failure => ({ tool, failure })),
  ))('keeps $tool receipts durable after a $failure failure without duplicate sends', async ({ tool, failure }) => {
    const fixture = await pending(tool, [failure]);
    try {
      await confirmOnce(fixture, true);
      expect(fixture.observed).toEqual(failure === 'projection' ? ['projection', 'execution'] : ['workspace', 'execution']);
      if (failure === 'projection') {
        // A readable stale chat must not hide the failed projection warning.
        expect(fixture.core.store.getWorkspaceChat(fixture.session.id)?.messages.some(message => message.approval?.id === fixture.approvalId)).toBe(true);
      }
    } finally { await close(fixture); }
  });
  it('runs the execution observer after a failed workspace observer and records one warning', async () => {
    const fixture = await pending('gmail', ['workspace', 'execution']);
    try {
      await confirmOnce(fixture, true);
      expect(fixture.observed).toEqual(['workspace', 'execution']);
    } finally { await close(fixture); }
  });
  it('runs the execution observer after a failed projection and records one warning', async () => {
    const fixture = await pending('gmail', ['projection', 'execution']);
    try {
      await confirmOnce(fixture, true);
      expect(fixture.observed).toEqual(['projection', 'execution']);
    } finally { await close(fixture); }
  });
  it('completes clean presentation without inventing a refresh warning', async () => {
    const fixture = await pending();
    try {
      await confirmOnce(fixture, false);
      expect(fixture.observed).toEqual(['workspace', 'execution']);
    } finally { await close(fixture); }
  });
});
