import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ExecutionResult, ToolResultConfirmation } from '@ax-studio/core';
import type { WorkspaceChatMessageContext } from './contracts';
import { createWorkspaceWorkflowActions } from './workflow-actions';

const confirmation: ToolResultConfirmation = { approvalId: 'synthetic-approval', workspaceSessionId: 'synthetic-session', sealId: '00000000-0000-4000-8000-000000000001' };
const sent: ExecutionResult = { executionId: 'synthetic-execution', status: 'success', log: [], toolSendOutcome: {
  status: 'sent', receiptId: 'synthetic-receipt', paramsHash: 'a'.repeat(64), binding: { provider: 'gmail',
    accountId: 'sender@example.test', accountLabel: 'sender@example.test', destinationId: 'recipient@example.test', destinationLabel: 'recipient@example.test' },
} };
function fixture() {
  const context: WorkspaceChatMessageContext = {
    refs: { sessionEpochRef: { current: 1 }, workspaceSessionIdRef: { current: confirmation.workspaceSessionId }, activeRequestIdRef: { current: undefined },
      busyRef: { current: false }, sourceBusyRef: { current: false }, pendingWorkspaceChatRefreshRef: { current: undefined } },
    chatMessages: [], workspaceWorkflowState: null, workflowRegistered: false, refresh: vi.fn(async () => undefined),
    refreshMappedWorkspaceChat: vi.fn(async () => true), isViewingSession: id => id === confirmation.workspaceSessionId, isCurrentSession: epoch => epoch === 1,
    setWorkspaceContextKey: vi.fn(), setWorkspaceSessionId: vi.fn(), setChatMessages: vi.fn(), setWorkspaceWorkflowState: vi.fn(),
    setBusy: vi.fn(), setError: vi.fn(), setProgress: vi.fn(), setEditHint: vi.fn(), setWorkflowRegistered: vi.fn(), setWorkspaceSources: vi.fn(), setSourceBusy: vi.fn(),
  };
  const api = { confirmToolResult: vi.fn(async () => structuredClone(sent)), reject: vi.fn(async () => ({ ok: true })) };
  vi.stubGlobal('window', { ax: api });
  return { context, api, actions: createWorkspaceWorkflowActions(context) };
}
afterEach(() => vi.unstubAllGlobals());
describe('tool result workflow refresh', () => {
  it.each(['state', 'mapped'] as const)('preserves sent receipt with a warning when %s refresh fails', async failure => {
    const f = fixture();
    if (failure === 'state') vi.mocked(f.context.refresh).mockRejectedValueOnce(new Error('Synthetic refresh failure'));
    else vi.mocked(f.context.refreshMappedWorkspaceChat).mockResolvedValueOnce(false);
    expect(await f.actions.confirmToolResult(confirmation)).toMatchObject({ status: 'success', refreshWarning: true, toolSendOutcome: { status: 'sent', receiptId: 'synthetic-receipt' } });
    expect(f.api.confirmToolResult).toHaveBeenCalledTimes(1);
  });
  it('blocks a stale session before any confirmation IPC', async () => {
    const f = fixture(); f.context.refs.workspaceSessionIdRef.current = 'another-session';
    await expect(f.actions.confirmToolResult(confirmation)).rejects.toThrow();
    expect(f.api.confirmToolResult).not.toHaveBeenCalled();
  });
  it('does not reinterpret successful cancellation as a failure when a later refresh throws', async () => {
    const f = fixture(); vi.mocked(f.context.refresh).mockRejectedValueOnce(new Error('Synthetic refresh failure'));
    await expect(f.actions.rejectChatApproval(confirmation.approvalId)).resolves.toBeUndefined();
    expect(f.api.reject).toHaveBeenCalledTimes(1);
    expect(f.context.setError).toHaveBeenCalled();
  });
});
