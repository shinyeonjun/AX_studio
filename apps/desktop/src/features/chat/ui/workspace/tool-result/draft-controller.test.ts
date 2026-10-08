import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EditableToolResult, ExecutionResult, MessageToolDraft, ToolResultReview } from '@ax-studio/core';
import { toolDraftError, cachedToolDraft, cachedToolDraftForExecution, clearToolDrafts, ToolDraftController, type ToolDraftApi } from './draft-controller';

const sessions = new Set<string>();
afterEach(() => { sessions.forEach(clearToolDrafts); sessions.clear(); });
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
function fixture(tool: 'gmail' | 'slack' = 'gmail') {
  const source: EditableToolResult = {
    approvalId: 'fixture-approval-' + tool, executionId: 'fixture-execution', workspaceSessionId: 'fixture-session-' + tool,
    actionId: 'send', paramsHash: 'a'.repeat(64), connectionHash: 'b'.repeat(64), connectionRevision: 1,
    revision: 0, tool, blockedFields: [],
    draft: tool === 'gmail' ? { tool, to: 'recipient@example.test', subject: 'Fixture subject', body: 'Known draft' }
      : { tool, channel: '#fixture', text: 'Known message' },
  };
  sessions.add(source.workspaceSessionId);
  const reviewValue = (draft: MessageToolDraft, revision: number): ToolResultReview => ({
    confirmation: { approvalId: source.approvalId, workspaceSessionId: source.workspaceSessionId, sealId: '00000000-0000-4000-8000-000000000001' },
    revision, draft: structuredClone(draft), paramsHash: 'c'.repeat(64),
    binding: tool === 'gmail' ? { provider: tool, accountId: 'sender@example.test', accountLabel: 'sender@example.test',
      destinationId: draft.tool === 'gmail' ? draft.to : '', destinationLabel: draft.tool === 'gmail' ? draft.to : '' }
      : { provider: tool, accountId: 'U12345678', accountLabel: 'Fixture bot', workspaceId: 'T12345678', workspaceLabel: 'Fixture workspace', destinationId: 'C12345678', destinationLabel: '#fixture' },
  });
  let hostDraft = structuredClone(source.draft);
  const api: ToolDraftApi = {
    update: vi.fn(async input => { hostDraft = structuredClone(input.draft); return { ...source, draft: hostDraft, revision: input.revision }; }),
    review: vi.fn(async input => reviewValue(hostDraft, input.revision)),
  };
  const controller = new ToolDraftController(source, api);
  const sent = (): ExecutionResult => ({ executionId: source.executionId, status: 'success', log: [],
    toolSendOutcome: { status: 'sent', receiptId: 'fixture-receipt', binding: reviewValue(hostDraft, 0).binding, paramsHash: 'c'.repeat(64) } });
  return { source, api, controller, reviewValue, sent };
}
const manual: MessageToolDraft = { tool: 'gmail', to: 'override@example.test', subject: '', body: 'Literal {{value}}\n**human text**' };

describe('tool draft controller', () => {
  it.each(['gmail', 'slack'] as const)('shows known %s values and allows initial human writing', async tool => {
    const f = fixture(tool);
    expect(f.controller.getSnapshot().draft).toEqual(f.source.draft);
    const draft: MessageToolDraft = tool === 'gmail' ? manual : { tool, channel: '#manual', text: 'Human {{literal}}' };
    f.controller.edit(draft);
    await f.controller.review();
    expect(f.controller.getSnapshot()).toMatchObject({ draft, revision: 1, phase: 'review' });
    expect(f.api.update).toHaveBeenCalledWith(expect.objectContaining({ draft, revision: 1 }));
  });
  it.each([
    [{ tool: 'gmail', to: '', subject: '', body: 'Human body' }, '받는 사람'],
    [{ tool: 'gmail', to: 'a@example.test', subject: '', body: '' }, '본문'],
    [{ tool: 'slack', channel: '', text: 'Human message' }, '채널'],
    [{ tool: 'slack', channel: '#fixture', text: '' }, '메시지'],
  ] as const)('asks only for the missing essential', async (draft, label) => {
    const f = fixture(draft.tool);
    f.controller.edit(draft);
    await f.controller.review();
    expect(f.controller.getSnapshot()).toMatchObject({ phase: 'editing', draft, error: expect.stringContaining(label) });
    expect(f.api.review).not.toHaveBeenCalled();
  });
  it('keeps an invalid address editable without resolving a guessed recipient', async () => {
    const f = fixture();
    f.controller.edit({ ...manual, to: 'Someone' });
    await f.controller.review();
    expect(f.controller.getSnapshot().error).toContain('정확한 이메일');
    expect(f.api.review).not.toHaveBeenCalled();
  });
  it('preserves unsupported thread intent and blocks review', async () => {
    const f = fixture('slack');
    f.source.blockedFields = ['thread_ts'];
    f.source.threadReference = '100.000';
    await f.controller.review();
    expect(f.controller.source.threadReference).toBe('100.000');
    expect(f.controller.getSnapshot().phase).toBe('editing');
    expect(f.api.review).not.toHaveBeenCalled();
  });
  it('locks double review clicks synchronously and waits for pending edit updates', async () => {
    const f = fixture();
    const update = deferred<EditableToolResult>();
    vi.mocked(f.api.update).mockImplementationOnce(() => update.promise);
    f.controller.edit(manual);
    const first = f.controller.review();
    await f.controller.review();
    expect(f.controller.getSnapshot().phase).toBe('preparing');
    expect(f.api.review).not.toHaveBeenCalled();
    update.resolve({ ...f.source, draft: manual, revision: 1 });
    await first;
    expect(f.api.review).toHaveBeenCalledTimes(1);
  });
  it('blocks review after an edit update fails and preserves human content', async () => {
    const f = fixture();
    vi.mocked(f.api.update).mockRejectedValueOnce(new Error('tool_result_stale'));
    f.controller.edit(manual);
    await f.controller.review();
    expect(f.controller.getSnapshot()).toMatchObject({ phase: 'editing', draft: manual, error: expect.any(String) });
    expect(f.api.review).not.toHaveBeenCalled();
    f.controller.edit({ ...manual, subject: 'Try fresh review' });
    await f.controller.review();
    expect(f.controller.getSnapshot().phase).toBe('review');
  });
  it('invalidates confirmation immediately after any edit', async () => {
    const f = fixture();
    await f.controller.review();
    f.controller.edit(manual);
    const send = vi.fn(async () => f.sent());
    await f.controller.confirm(send);
    expect(f.controller.getSnapshot()).toMatchObject({ phase: 'editing', revision: 1, draft: manual });
    expect(f.controller.getSnapshot().review).toBeUndefined();
    expect(send).not.toHaveBeenCalled();
  });
  it('back navigation invalidates the seal while preserving the edited body', async () => {
    const f = fixture();
    f.controller.edit(manual);
    await f.controller.review();
    f.controller.back();
    const send = vi.fn(async () => f.sent());
    await f.controller.confirm(send);
    await f.controller.review();
    expect(f.api.update).toHaveBeenLastCalledWith(expect.objectContaining({ draft: manual, revision: 2 }));
    expect(send).not.toHaveBeenCalled();
  });
  it('ignores a delayed review after another edit', async () => {
    const f = fixture();
    const late = deferred<ToolResultReview>();
    vi.mocked(f.api.review).mockImplementationOnce(() => late.promise);
    const pending = f.controller.review();
    await vi.waitFor(() => expect(f.api.review).toHaveBeenCalledOnce());
    f.controller.edit(manual);
    late.resolve(f.reviewValue(f.source.draft, 0));
    await pending;
    expect(f.controller.getSnapshot()).toMatchObject({ phase: 'editing', draft: manual });
    expect(f.controller.getSnapshot().review).toBeUndefined();
  });
  it('connection changes invalidate review without erasing manual values', async () => {
    const f = fixture();
    f.controller.edit(manual);
    await f.controller.review();
    f.controller.syncSource({ ...f.source, connectionRevision: 2 });
    expect(f.controller.getSnapshot()).toMatchObject({ phase: 'editing', draft: manual });
    expect(f.controller.getSnapshot().review).toBeUndefined();
  });
  it('claims one confirmation while double clicks, edits and cancellation are locked', async () => {
    const f = fixture();
    await f.controller.review();
    const dispatch = deferred<ExecutionResult>();
    const send = vi.fn(() => dispatch.promise);
    const reject = vi.fn(async () => undefined);
    const first = f.controller.confirm(send);
    await f.controller.confirm(send);
    f.controller.edit(manual);
    await f.controller.cancel(reject);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(f.reviewValue(f.source.draft, 0).confirmation);
    expect(reject).not.toHaveBeenCalled();
    expect(f.controller.getSnapshot().draft).toEqual(f.source.draft);
    dispatch.resolve({ ...f.sent(), refreshWarning: true });
    await first;
    expect(f.controller.getSnapshot()).toMatchObject({ phase: 'sent', refreshWarning: true });
  });
  it('a preflight failure keeps the approval editable and requires fresh review', async () => {
    const f = fixture();
    await f.controller.review();
    const send = vi.fn(async (): Promise<ExecutionResult> => ({ executionId: f.source.executionId, status: 'failed', log: [], pendingApprovalId: f.source.approvalId, errorCode: 'tool_result_stale' }));
    await f.controller.confirm(send);
    await f.controller.confirm(send);
    expect(f.controller.getSnapshot().phase).toBe('editing');
    expect(send).toHaveBeenCalledTimes(1);
  });
  it.each(['unknown', 'throw', 'success-without-receipt'] as const)('never retries an uncertain %s outcome', async kind => {
    const f = fixture();
    await f.controller.review();
    const send = vi.fn(async (): Promise<ExecutionResult> => {
      if (kind === 'throw') throw new Error('lost IPC reply');
      return { executionId: f.source.executionId, status: kind === 'unknown' ? 'failed' : 'success', log: [] };
    });
    await f.controller.confirm(send);
    await f.controller.confirm(send);
    await f.controller.review();
    expect(f.controller.getSnapshot().phase).toBe('unresolved');
    expect(send).toHaveBeenCalledTimes(1);
  });
  it('cancellation wins once and clears the draft; a late review cannot revive it', async () => {
    const f = fixture();
    const late = deferred<ToolResultReview>();
    vi.mocked(f.api.review).mockImplementationOnce(() => late.promise);
    const pending = f.controller.review();
    await vi.waitFor(() => expect(f.api.review).toHaveBeenCalledOnce());
    const cancellation = deferred<void>();
    const reject = vi.fn(() => cancellation.promise);
    const first = f.controller.cancel(reject);
    await f.controller.cancel(reject);
    cancellation.resolve();
    await first;
    late.resolve(f.reviewValue(f.source.draft, 0));
    await pending;
    expect(f.controller.getSnapshot()).toMatchObject({ phase: 'cancelled', draft: { tool: 'gmail', to: '', subject: '', body: '' } });
    expect(reject).toHaveBeenCalledTimes(1);
  });
  it('failed cancellation preserves the editable draft', async () => {
    const f = fixture();
    f.controller.edit(manual);
    await f.controller.cancel(async () => { throw new Error('not cancelled'); });
    expect(f.controller.getSnapshot()).toMatchObject({ phase: 'editing', draft: manual });
  });
  it('ordinary navigation preserves edits but requires fresh review on return', async () => {
    const f = fixture();
    const controller = cachedToolDraft(f.source, f.api);
    controller.edit(manual);
    await controller.review();
    controller.dispose();
    const reopened = cachedToolDraft(f.source, f.api);
    reopened.activate();
    expect(reopened).toBe(controller);
    expect(reopened.getSnapshot()).toMatchObject({ phase: 'editing', draft: manual });
    clearToolDrafts(f.source.workspaceSessionId);
    expect(cachedToolDraft(f.source, f.api).getSnapshot().draft).toEqual(f.source.draft);
  });
  it('late completion belongs only to its original approval after switching tools', async () => {
    const gmail = fixture();
    const slack = fixture('slack');
    const late = deferred<ExecutionResult>();
    await gmail.controller.review();
    const sending = gmail.controller.confirm(() => late.promise);
    gmail.controller.dispose();
    slack.controller.edit({ tool: 'slack', channel: '#other', text: 'Other tool draft' });
    late.resolve(gmail.sent());
    await sending;
    expect(gmail.controller.getSnapshot().phase).toBe('sent');
    expect(slack.controller.getSnapshot()).toMatchObject({ phase: 'editing', draft: { tool: 'slack', channel: '#other', text: 'Other tool draft' } });
  });
  it('completion warnings stay scoped to their execution and tool until the session is cleared', async () => {
    const f = fixture();
    const controller = cachedToolDraft(f.source, f.api);
    await controller.review();
    await controller.confirm(async () => ({ ...f.sent(), refreshWarning: true }));
    controller.dispose();
    expect(cachedToolDraftForExecution(f.source.executionId, 'gmail')?.getSnapshot()).toMatchObject({ phase: 'sent', refreshWarning: true });
    expect(cachedToolDraftForExecution(f.source.executionId, 'slack')).toBeUndefined();
    expect(cachedToolDraftForExecution('another-execution', 'gmail')).toBeUndefined();
    expect(cachedToolDraftForExecution(undefined, 'gmail')).toBeUndefined();
    clearToolDrafts(f.source.workspaceSessionId);
    expect(cachedToolDraftForExecution(f.source.executionId, 'gmail')).toBeUndefined();
  });

  it('does not blame the draft for a failure that is not the draft', () => {
    expect(toolDraftError(new Error('fetch failed'))).toContain('서버에 연결할 수 없어요');
    expect(toolDraftError(new Error('socket hang up'))).toContain('연결 상태를 확인');
    expect(toolDraftError(new Error('socket hang up'))).toContain('보내지 않았습니다');
    expect(toolDraftError(new Error('socket hang up'))).not.toContain('초안');
  });
});
