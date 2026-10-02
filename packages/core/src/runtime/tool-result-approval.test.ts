import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDatabaseAsync } from '../persistence/db.js';
import { WorkflowStore } from '../persistence/workflow-store.js';
import { WorkflowRuntime } from './engine.js';
import { MessageToolDraftSchema, messageToolDraft, type MessageToolDraft, type MessageSendBinding, type ToolResultReview } from '../contracts/tool-result.js';
import type { WorkflowIR } from '../workflow/schema.js';
import type { Connector, ConnectorResult } from '../connectors/types.js';
import { createTestConnectors } from '../testing/connectors/test-connectors.js';
import { publishExecutionResultToWorkspaceChat } from './execution-result/publish.js';

const databases: Awaited<ReturnType<typeof createDatabaseAsync>>[] = [];
afterEach(() => { databases.splice(0).forEach(db => db.close?.()); });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
async function pending(tool: 'gmail' | 'slack' = 'gmail', options: { remaining?: boolean; extras?: Record<string, unknown> } = {}) {
  const db = await createDatabaseAsync(':memory:');
  databases.push(db);
  const store = new WorkflowStore(db);
  store.setConnection(tool, true, { account: 'unverified-label@example.test', team: 'Unverified label' });
  const session = store.saveWorkspaceChat({ messages: [{ role: 'user', content: 'Synthetic send only' }] });
  const calls: Array<{ params: Record<string, unknown>; literal: boolean }> = [];
  const connector: Connector = {
    name: tool,
    prepareMessageSend: vi.fn(async (draft: MessageToolDraft): Promise<MessageSendBinding> => {
      if (draft.tool !== tool) throw new Error('tool_result_identity_unverified');
      if (draft.tool === 'slack' && !['#synthetic', 'C12345678', 'C87654321'].includes(draft.channel)) throw new Error('tool_result_destination_unknown');
      return tool === 'gmail'
        ? { provider: 'gmail', accountId: 'verified@example.test', accountLabel: 'verified@example.test', destinationId: draft.tool === 'gmail' ? draft.to.trim() : '', destinationLabel: draft.tool === 'gmail' ? draft.to.trim() : '' }
        : { provider: 'slack', accountId: 'U12345678', accountLabel: 'Synthetic bot', workspaceId: 'T12345678',
          workspaceLabel: 'Verified synthetic workspace', destinationId: draft.tool === 'slack' && draft.channel === 'C87654321' ? draft.channel : 'C12345678', destinationLabel: '#synthetic' };
    }),
    execute: vi.fn(async (_action, params, ctx) => {
      calls.push({ params: structuredClone(params), literal: ctx.literalMessage === true });
      return { ok: true, data: tool === 'gmail' ? { id: 'synthetic-gmail-receipt' } : { ts: '100.001', channel: params.channel } };
    }),
  };
  const connectors = { ...createTestConnectors(), [tool]: connector };
  const config = { store, globalActive: true, workflowActive: {}, connectors };
  const runtime = new WorkflowRuntime(config);
  const ir: WorkflowIR = {
    name: 'Synthetic send', goal: 'Exact confirmation fixture', version: 1, inputs: [],
    steps: [{ type: 'action', id: 'send', connector: tool, action: 'message.send', sideEffect: tool === 'gmail' ? 'EXTERNAL_HIGH' : 'EXTERNAL',
      params: { ...(tool === 'gmail' ? { to: 'recipient@example.test', subject: 'Fixture', body: 'x'.repeat(700) } : { channel: '#synthetic', text: 'Original message' }), ...options.extras } }],
    permissions: {}, approval: [], allowExternalAuto: false, assumptions: [], sideEffects: {}, dataPolicy: {},
  };
  if (options.remaining) ir.steps.push({ type: 'action', id: 'next', connector: 'gmail', action: 'message.send', sideEffect: 'EXTERNAL_HIGH', params: { to: 'next@example.test', body: 'Next' } });
  const result = await runtime.executeWorkflow(ir, { ephemeral: true, workspaceSessionId: session.id });
  expect(result.status).toBe('pending_approval');
  const approvalId = result.pendingApprovalId!;
  const source = runtime.getToolResult(approvalId);
  return { db, store, config, runtime, result, source, ir, session, connector, calls, approvalId };
}
type Fixture = Awaited<ReturnType<typeof pending>>;
async function review(fixture: Fixture, draft = fixture.source!.draft): Promise<ToolResultReview> {
  const source = fixture.runtime.getToolResult(fixture.approvalId)!;
  const changed = JSON.stringify(source.draft) !== JSON.stringify(draft);
  const revision = source.revision + (changed ? 1 : 0);
  fixture.runtime.updateToolDraft({ approvalId: fixture.approvalId, workspaceSessionId: fixture.session.id, revision, draft });
  return fixture.runtime.reviewToolResult({ approvalId: fixture.approvalId, workspaceSessionId: fixture.session.id, revision });
}

describe('verified tool result approvals', () => {
  it('reconstructs complete original content and persists references without another body', async () => {
    const f = await pending();
    expect(f.source?.draft).toMatchObject({ tool: 'gmail', body: 'x'.repeat(700) });
    expect(JSON.stringify(f.store.getApproval(f.approvalId)?.payload)).not.toContain('toolDraft');
    expect(JSON.stringify(f.store.getApproval(f.approvalId)?.payload)).not.toContain('toolOriginalParams');
    publishExecutionResultToWorkspaceChat(f.store, f.result);
    const ref = f.store.getWorkspaceChat(f.session.id)?.messages.at(-1)?.approval?.toolResult;
    expect(ref).toMatchObject({ approvalId: f.approvalId, tool: 'gmail' });
    expect(ref).not.toHaveProperty('draft');
  });
  it.each(['gmail', 'slack'] as const)('dispatches literal edits exactly once with a receipt for %s', async tool => {
    const f = await pending(tool);
    const draft: MessageToolDraft = tool === 'gmail'
      ? { tool, to: 'override@example.test', subject: '', body: 'Manual {{secret}}\n**unchanged**' }
      : { tool, channel: 'C87654321', text: 'Manual {{secret}}\n**unchanged**' };
    const sealed = await review(f, draft);
    const results = await Promise.all([f.runtime.continueAfterApproval(f.approvalId, sealed.confirmation), f.runtime.continueAfterApproval(f.approvalId, sealed.confirmation)]);
    expect(results.filter(result => result.status === 'success')).toHaveLength(1);
    expect(f.calls).toEqual([{ params: tool === 'gmail' ? { to: draft.tool === 'gmail' ? draft.to : '', subject: '', body: 'Manual {{secret}}\n**unchanged**' }
      : { channel: 'C87654321', text: 'Manual {{secret}}\n**unchanged**' }, literal: true }]);
    expect(results.find(result => result.status === 'success')?.toolSendOutcome).toMatchObject({ status: 'sent', receiptId: tool === 'gmail' ? 'synthetic-gmail-receipt' : '100.001' });
  });
  it('blocks generic approval even before a draft is opened', async () => {
    const f = await pending();
    expect((await f.runtime.continueAfterApproval(f.approvalId)).errorCode).toBe('tool_result_confirmation_required');
    expect(f.store.getApproval(f.approvalId)?.status).toBe('pending');
    expect(f.calls).toHaveLength(0);
  });
  it('blocks generic approval after edits and review', async () => {
    const f = await pending();
    await review(f, { tool: 'gmail', to: 'human@example.test', subject: '', body: 'Human content' });
    expect((await f.runtime.continueAfterApproval(f.approvalId)).errorCode).toBe('tool_result_confirmation_required');
    expect(f.calls).toHaveLength(0);
  });
  it.each([
    { tool: 'gmail', to: '', subject: '', body: 'Body' },
    { tool: 'gmail', to: 'a@example.test', subject: '', body: '' },
    { tool: 'gmail', to: 'Unknown Person', subject: '', body: 'Body' },
  ] as const)('keeps a missing/invalid essential pending and unsent', async draft => {
    const f = await pending();
    await expect(review(f, draft)).rejects.toThrow(/essentials_missing|recipient_invalid/);
    expect(f.store.getApproval(f.approvalId)?.status).toBe('pending');
    expect(f.runtime.getToolResult(f.approvalId)?.draft).toEqual(draft);
    expect(f.calls).toHaveLength(0);
  });
  it('rejects a seal after edits, then permits fresh exact review', async () => {
    const f = await pending();
    const sealed = await review(f);
    const draft = { tool: 'gmail' as const, to: 'edited@example.test', subject: '', body: 'Edited after review' };
    f.runtime.updateToolDraft({ approvalId: f.approvalId, workspaceSessionId: f.session.id, revision: 1, draft });
    expect((await f.runtime.continueAfterApproval(f.approvalId, sealed.confirmation)).pendingApprovalId).toBe(f.approvalId);
    expect(f.calls).toHaveLength(0);
    const fresh = await review(f, draft);
    expect((await f.runtime.continueAfterApproval(f.approvalId, fresh.confirmation)).status).toBe('success');
  });
  it.each(['account', 'instance'] as const)('invalidates review on connection %s change', async kind => {
    const f = await pending();
    const sealed = await review(f);
    if (kind === 'account') f.store.setConnection('gmail', true, { account: 'different@example.test' });
    else f.runtime.setConnector('gmail', { ...f.connector });
    expect((await f.runtime.continueAfterApproval(f.approvalId, sealed.confirmation)).errorCode).toBe('tool_result_stale');
    expect(f.store.getApproval(f.approvalId)?.status).toBe('pending');
    expect(f.calls).toHaveLength(0);
  });
  it('uses authenticated identity rather than configuration labels', async () => {
    const f = await pending('slack');
    const sealed = await review(f);
    expect(sealed.binding).toMatchObject({ workspaceId: 'T12345678', workspaceLabel: 'Verified synthetic workspace', destinationId: 'C12345678' });
    expect(JSON.stringify(sealed)).not.toContain('Unverified label');
  });
  it('ignores an older asynchronous identity review for the same draft revision', async () => {
    const f = await pending('slack');
    const older = deferred<MessageSendBinding>();
    const prepare = vi.mocked(f.connector.prepareMessageSend!);
    prepare.mockImplementationOnce(() => older.promise);
    const first = review(f).then(value => ({ value }), error => ({ error }));
    const latest = await review(f);
    older.resolve({ ...latest.binding, accountId: 'U87654321', accountLabel: 'Older identity' });
    const stale = await first;
    expect('error' in stale && String(stale.error)).toContain('tool_result_stale');
    expect((await f.runtime.continueAfterApproval(f.approvalId, latest.confirmation)).status).toBe('success');
    expect(f.calls).toHaveLength(1);
  });
  it('blocks unknown channel instead of guessing a destination', async () => {
    const f = await pending('slack');
    await expect(review(f, { tool: 'slack', channel: '#unknown', text: 'Keep this content' })).rejects.toThrow('tool_result_destination_unknown');
    expect(f.store.getApproval(f.approvalId)?.status).toBe('pending');
    expect(f.calls).toHaveLength(0);
  });
  it('blocks unverified identity even with plausible account labels', async () => {
    const f = await pending();
    f.connector.prepareMessageSend = undefined;
    await expect(review(f)).rejects.toThrow('tool_result_identity_unverified');
    expect(f.calls).toHaveLength(0);
  });
  it.each(['workspaceSessionId', 'sealId'] as const)('rejects a stale %s', async key => {
    const f = await pending();
    const sealed = await review(f);
    sealed.confirmation[key] = key === 'sealId' ? '00000000-0000-4000-8000-000000000000' : 'other-session';
    expect((await f.runtime.continueAfterApproval(f.approvalId, sealed.confirmation)).errorCode).toBe('tool_result_stale');
    expect(f.calls).toHaveLength(0);
  });
  it('rejects client injection of payload/identity fields into confirmation', async () => {
    const f = await pending();
    const sealed = await review(f);
    const injected = { ...sealed.confirmation, draft: { tool: 'gmail', to: 'injected@example.test', subject: '', body: 'Wrong' } };
    expect((await f.runtime.continueAfterApproval(f.approvalId, injected)).status).toBe('failed');
    expect(f.calls).toHaveLength(0);
  });
  it('preserves and blocks unsupported thread intent on all routes', async () => {
    const f = await pending('slack', { extras: { thread_ts: '100.000' } });
    expect(f.source).toMatchObject({ blockedFields: ['thread_ts'], threadReference: '100.000' });
    await expect(review(f)).rejects.toThrow('tool_result_unsupported_fields');
    expect((await f.runtime.continueAfterApproval(f.approvalId)).errorCode).toBe('tool_result_confirmation_required');
    expect(f.calls).toHaveLength(0);
  });
  it('blocks attachments rather than removing them from a Gmail send', async () => {
    const f = await pending('gmail', { extras: { attachments: ['synthetic-file'] } });
    expect(f.source?.blockedFields).toEqual(['attachments']);
    await expect(review(f)).rejects.toThrow('tool_result_unsupported_fields');
    expect(f.calls).toHaveLength(0);
  });
  it('does not revive a cancelled approval', async () => {
    const f = await pending();
    const sealed = await review(f);
    expect(f.store.rejectPendingApproval(f.approvalId)).toBe(true);
    f.runtime.discardToolDraft(f.approvalId);
    expect((await f.runtime.continueAfterApproval(f.approvalId, sealed.confirmation)).status).toBe('failed');
    expect(f.calls).toHaveLength(0);
  });
  it('does not promise cancellation after claim and pins the verified connector', async () => {
    const f = await pending();
    const completed = deferred<ConnectorResult>();
    f.connector.execute = vi.fn(async (_action, params, ctx) => {
      f.calls.push({ params: structuredClone(params), literal: ctx.literalMessage === true });
      return completed.promise;
    });
    const sealed = await review(f);
    const sending = f.runtime.continueAfterApproval(f.approvalId, sealed.confirmation);
    expect(f.store.getApproval(f.approvalId)?.status).toBe('processing');
    expect(f.store.rejectPendingApproval(f.approvalId)).toBe(false);
    const replacement = { name: 'gmail', execute: vi.fn(async () => ({ ok: true, data: { id: 'wrong' } })) };
    f.runtime.setConnector('gmail', replacement);
    completed.resolve({ ok: true, data: { id: 'pinned-receipt' } });
    expect((await sending).status).toBe('success');
    expect(replacement.execute).not.toHaveBeenCalled();
    expect(f.calls).toHaveLength(1);
  });
  it.each(['throw', 'failed', 'missing_receipt'] as const)('makes %s dispatch terminal unknown without replay', async mode => {
    const f = await pending();
    f.connector.execute = vi.fn(async () => {
      f.calls.push({ params: {}, literal: true });
      if (mode === 'throw') throw new Error('Synthetic timeout');
      return mode === 'failed' ? { ok: false, error: 'Synthetic timeout', errorCode: 'timeout' } : { ok: true, data: {} };
    });
    const sealed = await review(f);
    const result = await f.runtime.continueAfterApproval(f.approvalId, sealed.confirmation);
    expect(result.toolSendOutcome?.status).toBe('unknown');
    expect(f.store.getApproval(f.approvalId)?.status).toBe('failed');
    await f.runtime.continueAfterApproval(f.approvalId, sealed.confirmation);
    await f.runtime.continueAfterApproval(f.approvalId);
    expect(f.calls).toHaveLength(1);
  });
  it('does not turn confirmed sending into failure when a host observer refresh fails', async () => {
    const f = await pending();
    const observerRuntime = new WorkflowRuntime({ ...f.config, onExecutionFinished: () => { throw new Error('Refresh failed'); } });
    const source = observerRuntime.getToolResult(f.approvalId)!;
    const sealed = await observerRuntime.reviewToolResult({ approvalId: f.approvalId, workspaceSessionId: f.session.id, revision: source.revision });
    const result = await observerRuntime.continueAfterApproval(f.approvalId, sealed.confirmation);
    expect(result.status).toBe('success');
    expect(result.toolSendOutcome?.status).toBe('sent');
    expect(f.calls).toHaveLength(1);
  });
  it('ignores a delayed review after a newer edit', async () => {
    const f = await pending();
    const lookup = deferred<Awaited<ReturnType<NonNullable<Connector['prepareMessageSend']>>>>();
    f.connector.prepareMessageSend = vi.fn(() => lookup.promise);
    const stale = review(f);
    f.runtime.updateToolDraft({ approvalId: f.approvalId, workspaceSessionId: f.session.id, revision: 1,
      draft: { tool: 'gmail', to: 'new@example.test', subject: '', body: 'New content' } });
    lookup.resolve({ provider: 'gmail', accountId: 'verified@example.test', accountLabel: 'verified@example.test',
      destinationId: 'recipient@example.test', destinationLabel: 'recipient@example.test' });
    await expect(stale).rejects.toThrow('tool_result_stale');
    expect(f.calls).toHaveLength(0);
  });
  it('rejects a delayed older draft update', async () => {
    const f = await pending();
    f.runtime.updateToolDraft({ approvalId: f.approvalId, workspaceSessionId: f.session.id, revision: 2,
      draft: { tool: 'gmail', to: 'new@example.test', subject: '', body: 'Latest' } });
    expect(() => f.runtime.updateToolDraft({ approvalId: f.approvalId, workspaceSessionId: f.session.id, revision: 1, draft: f.source!.draft })).toThrow('tool_result_stale');
    expect(f.runtime.getToolResult(f.approvalId)?.draft).toMatchObject({ body: 'Latest' });
  });
  it('loses unsent edits and seals on restart and requires a fresh original review', async () => {
    const f = await pending();
    const old = await review(f, { tool: 'gmail', to: 'edited@example.test', subject: '', body: 'Memory only' });
    const restarted = new WorkflowRuntime(f.config);
    expect(restarted.getToolResult(f.approvalId)?.draft).toEqual(f.source?.draft);
    expect((await restarted.continueAfterApproval(f.approvalId, old.confirmation)).errorCode).toBe('tool_result_stale');
    const fresh = await restarted.reviewToolResult({ approvalId: f.approvalId, workspaceSessionId: f.session.id, revision: 0 });
    expect((await restarted.continueAfterApproval(f.approvalId, fresh.confirmation)).status).toBe('success');
  });
  it.each([false, true])('recovers an interrupted claim without replay (durable receipt=%s)', async sent => {
    const f = await pending();
    const sealed = await review(f);
    f.store.claimApproval(f.approvalId);
    f.store.updateApprovalPayload(f.approvalId, { toolSendIntent: { binding: sealed.binding, paramsHash: sealed.paramsHash },
      ...(sent ? { toolSendOutcome: { status: 'sent', binding: sealed.binding, paramsHash: sealed.paramsHash, receiptId: 'durable-receipt' } } : {}) });
    const restarted = new WorkflowRuntime(f.config);
    expect(f.store.getExecution(f.result.executionId)?.status).toBe(sent ? 'success' : 'failed');
    expect(f.store.getApproval(f.approvalId)?.status).toBe(sent ? 'approved' : 'failed');
    await restarted.continueAfterApproval(f.approvalId, sealed.confirmation);
    expect(f.calls).toHaveLength(0);
  });
  it('checks original binding before claim even after manual edits', async () => {
    const f = await pending();
    const sealed = await review(f);
    const changed = structuredClone(f.ir);
    if (changed.steps[0]?.type === 'action') changed.steps[0].params.to = 'tampered@example.test';
    f.db.prepare('UPDATE executions SET ir_json = ? WHERE id = ?').run(JSON.stringify(changed), f.result.executionId);
    expect((await f.runtime.continueAfterApproval(f.approvalId, sealed.confirmation)).errorCode).toBe('approval_target_changed');
    expect(f.store.getApproval(f.approvalId)?.status).toBe('pending');
    expect(f.calls).toHaveLength(0);
  });
  it('does not edit sends with downstream consequences', async () => {
    const f = await pending('gmail', { remaining: true });
    expect(f.source).toBeUndefined();
  });
  it('rejects unsupported fields and header injection in the literal schema', () => {
    expect(messageToolDraft('gmail.message.send', { to: 'a@example.test', body: 'Body', attachments: ['file'] })).toBeUndefined();
    expect(messageToolDraft('slack.message.send', { channel: 'C123', text: 'Body', thread_ts: '1.2' })).toBeUndefined();
    expect(MessageToolDraftSchema.safeParse({ tool: 'gmail', to: 'a@example.test\nBcc: b@example.test', subject: '', body: 'Body' }).success).toBe(false);
  });
});
