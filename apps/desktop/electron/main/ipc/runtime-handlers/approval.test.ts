import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExecutionResult, ToolResultConfirmation } from '@ax-studio/core';

const mocks = vi.hoisted(() => {
  const frame = { url: 'app://index' };
  return { frame, handlers: new Map<string, (event: unknown, input: unknown) => unknown>(), getCore: vi.fn(), notify: vi.fn(),
    window: { isDestroyed: () => false, webContents: { id: 42, mainFrame: frame } },
  };
});
vi.mock('electron', () => ({ ipcMain: { removeHandler: vi.fn(), handle: (name: string, handler: (event: unknown, input: unknown) => unknown) => mocks.handlers.set(name, handler) } }));
vi.mock('../../app-window.js', () => ({ getMainWindow: () => mocks.window, isTrustedRendererUrl: (url: string) => url === 'app://index' }));
vi.mock('../../core-instance.js', () => ({ getCore: mocks.getCore }));
vi.mock('../../state-broadcast.js', () => ({ notifyStateChanged: mocks.notify }));
import { registerRuntimeApprovalHandlers } from './approval.js';

const confirmation: ToolResultConfirmation = { approvalId: 'approval-fixture', workspaceSessionId: 'session-fixture', sealId: '00000000-0000-4000-8000-000000000001' };
const event = () => ({ sender: { id: 42, mainFrame: mocks.frame }, senderFrame: mocks.frame });
function invoke(name: string, input: unknown, sender = event()) {
  return Promise.resolve().then(() => mocks.handlers.get(name)!(sender, input));
}
function fixture() {
  const result: ExecutionResult = { executionId: 'execution-fixture', status: 'success', log: [],
    toolSendOutcome: { status: 'sent', receiptId: 'fixture-receipt', paramsHash: 'c'.repeat(64),
      binding: { provider: 'gmail', accountId: 'sender@example.test', accountLabel: 'sender@example.test', destinationId: 'recipient@example.test', destinationLabel: 'recipient@example.test' } } };
  const core = { runtime: {
    getToolResult: vi.fn(() => undefined), getToolSendOutcome: vi.fn((): ExecutionResult['toolSendOutcome'] => undefined), requiresToolResultReview: vi.fn(() => true),
    updateToolDraft: vi.fn(async () => undefined), reviewToolResult: vi.fn(async () => undefined),
    continueAfterApproval: vi.fn(async () => result), discardToolDraft: vi.fn(), notifyExecutionFinished: vi.fn(),
  }, store: {
    getApproval: vi.fn(() => ({ id: confirmation.approvalId, executionId: result.executionId, status: 'pending' })),
    rejectPendingApproval: vi.fn(() => true), getExecution: vi.fn((): { logJson?: string; errorCode?: string; status?: string } | undefined => ({ logJson: 'invalid legacy log' })), finishExecution: vi.fn(),
  } };
  mocks.getCore.mockReturnValue(core);
  registerRuntimeApprovalHandlers();
  return { core, result };
}
beforeEach(() => { mocks.handlers.clear(); vi.clearAllMocks(); mocks.notify.mockReset(); });

describe('editable tool approval IPC', () => {
  it.each(['ax:getToolResult', 'ax:updateToolDraft', 'ax:reviewToolResult', 'ax:confirmToolResult', 'ax:reject'])('rejects an untrusted sender for %s before reading host state', async channel => {
    fixture();
    const untrusted = { ...event(), sender: { id: 99, mainFrame: mocks.frame } };
    await expect(invoke(channel, confirmation, untrusted)).rejects.toThrow('untrusted_ipc_sender');
    expect(mocks.getCore).not.toHaveBeenCalled();
  });
  it('rejects a subframe even from the trusted webContents', async () => {
    fixture();
    await expect(invoke('ax:confirmToolResult', confirmation, { ...event(), senderFrame: { url: 'app://index' } })).rejects.toThrow('untrusted_ipc_frame');
    expect(mocks.getCore).not.toHaveBeenCalled();
  });
  it.each(['', 42, 'a'.repeat(129)])('rejects an invalid approval identifier', async id => {
    fixture();
    await expect(invoke('ax:getToolResult', id)).rejects.toThrow('Invalid approval ID');
    expect(mocks.getCore).not.toHaveBeenCalled();
  });
  it('returns host classification so a missing editable source cannot enable generic approval', async () => {
    const { core } = fixture();
    expect(await invoke('ax:getToolResult', confirmation.approvalId)).toEqual({ source: undefined, outcome: undefined, requiresReview: true, cancelled: false, processing: false });
    expect(core.runtime.continueAfterApproval).not.toHaveBeenCalled();
  });
  it('passes only validated literal draft fields to the host', async () => {
    const { core } = fixture();
    const input = { approvalId: confirmation.approvalId, workspaceSessionId: confirmation.workspaceSessionId, revision: 1,
      draft: { tool: 'gmail', to: 'human@example.test', subject: '', body: 'Human {{literal}}' } };
    await invoke('ax:updateToolDraft', input);
    expect(core.runtime.updateToolDraft).toHaveBeenCalledWith(input);
    await expect(invoke('ax:updateToolDraft', { ...input, draft: { ...input.draft, attachments: ['file'] } })).rejects.toThrow();
    expect(core.runtime.updateToolDraft).toHaveBeenCalledTimes(1);
  });
  it.each([
    { ...confirmation, draft: { body: 'injected' } },
    { ...confirmation, binding: { accountId: 'injected' } },
    { ...confirmation, sealId: 'invalid' },
  ])('rejects replacement payload, identity and invalid seal fields', async input => {
    const { core } = fixture();
    await expect(invoke('ax:confirmToolResult', input)).rejects.toThrow();
    expect(core.runtime.continueAfterApproval).not.toHaveBeenCalled();
  });
  it('does not let a client-supplied draft travel in a review request', async () => {
    const { core } = fixture();
    await expect(invoke('ax:reviewToolResult', { approvalId: confirmation.approvalId, workspaceSessionId: confirmation.workspaceSessionId, revision: 1, draft: { tool: 'slack', text: 'injected' } })).rejects.toThrow();
    expect(core.runtime.reviewToolResult).not.toHaveBeenCalled();
  });
  it('preserves a provider receipt when notification fails', async () => {
    const { core, result } = fixture();
    mocks.notify.mockImplementationOnce(() => { throw new Error('screen unavailable'); });
    expect(await invoke('ax:confirmToolResult', confirmation)).toEqual({ ...result, refreshWarning: true });
    expect(result.toolSendOutcome).toMatchObject({ status: 'sent', receiptId: 'fixture-receipt' });
    expect(core.runtime.continueAfterApproval).toHaveBeenCalledWith(confirmation.approvalId, confirmation);
  });
  it('recovers a refresh warning from execution evidence without dropping the provider receipt', async () => {
    const { core, result } = fixture();
    core.runtime.getToolSendOutcome.mockReturnValueOnce(result.toolSendOutcome);
    core.store.getExecution.mockReturnValueOnce({ logJson: JSON.stringify([{ code: 'execution_refresh_failed' }]) });
    expect(await invoke('ax:getToolResult', confirmation.approvalId)).toMatchObject({ refreshWarning: true, outcome: { status: 'sent', receiptId: 'fixture-receipt' } });
  });
  it.each(['execution_refresh_failed', 'tool_send_presentation_failed', 'database_persistence_failed'])('reads %s warning evidence by execution ID without accessing draft or dispatch APIs', async code => {
    const { core } = fixture();
    core.store.getExecution.mockReturnValueOnce({ status: 'success', logJson: JSON.stringify([{ code, message: 'Synthetic host warning' }]) });
    expect(await invoke('ax:getToolResult', { executionId: 'execution-fixture' })).toEqual({
      executionId: 'execution-fixture', source: undefined, outcome: undefined, requiresReview: false,
      cancelled: false, processing: false, refreshWarning: true, ...(code === 'database_persistence_failed' ? { persistenceWarning: true } : {}),
    });
    expect(core.store.getExecution).toHaveBeenCalledWith('execution-fixture');
    expect(core.store.getApproval).not.toHaveBeenCalled();
    expect(core.runtime.getToolResult).not.toHaveBeenCalled();
    expect(core.runtime.getToolSendOutcome).not.toHaveBeenCalled();
    expect(core.runtime.continueAfterApproval).not.toHaveBeenCalled();
  });
  it('preserves persistence-warning classification and returns no log payload', async () => {
    const { core } = fixture();
    core.store.getExecution.mockReturnValueOnce({ errorCode: 'database_persistence_failed', logJson: 'invalid legacy log' });
    expect(await invoke('ax:getToolResult', { executionId: 'execution-fixture' })).toEqual({
      executionId: 'execution-fixture', source: undefined, outcome: undefined, requiresReview: false,
      cancelled: false, processing: false, refreshWarning: true, persistenceWarning: true,
    });
  });
  it.each([undefined, { logJson: 'invalid legacy log' }, { logJson: '[{"code":"unrelated_warning"}]' }])('missing or unrelated execution evidence cannot invent a warning', async execution => {
    const { core } = fixture();
    core.store.getExecution.mockReturnValueOnce(execution);
    const result = await invoke('ax:getToolResult', { executionId: 'execution-fixture' });
    expect(result).not.toHaveProperty('refreshWarning');
    expect(result).not.toHaveProperty('persistenceWarning');
  });
  it.each([{ executionId: '' }, { executionId: 'a'.repeat(129) }, { executionId: 42 }, { executionId: 'execution-fixture', approvalId: 'other' }])('rejects a malformed completed-result lookup before host access', async input => {
    fixture();
    await expect(invoke('ax:getToolResult', input)).rejects.toThrow('Invalid');
    expect(mocks.getCore).not.toHaveBeenCalled();
  });
  it('generic approval cannot forward a confirmation or replace its failed preflight result', async () => {
    const { core } = fixture();
    core.runtime.continueAfterApproval.mockResolvedValueOnce({ executionId: 'execution-fixture', status: 'failed', log: [{ at: '2026-10-02T00:00:00Z', level: 'error', message: 'tool_result_confirmation_required' }] });
    await expect(invoke('ax:approve', confirmation.approvalId)).rejects.toThrow('tool_result_confirmation_required');
    expect(core.runtime.continueAfterApproval).toHaveBeenCalledWith(confirmation.approvalId);
  });
  it('cancellation wins atomically, clears the seal and remains cancelled through observer failure', async () => {
    const { core } = fixture();
    core.runtime.notifyExecutionFinished.mockImplementationOnce(() => { throw new Error('observer unavailable'); });
    mocks.notify.mockImplementationOnce(() => { throw new Error('refresh unavailable'); });
    expect(await invoke('ax:reject', confirmation.approvalId)).toEqual({ ok: true });
    expect(core.runtime.discardToolDraft).toHaveBeenCalledWith(confirmation.approvalId);
    expect(core.store.finishExecution).toHaveBeenCalledWith('execution-fixture', 'cancelled', 'approval_rejected', expect.arrayContaining([expect.objectContaining({ code: 'approval_rejected' })]), { preserveHistory: false });
    expect(core.runtime.continueAfterApproval).not.toHaveBeenCalled();
  });
  it('losing cancellation cannot erase an in-flight draft or alter a claimed execution', async () => {
    const { core } = fixture();
    core.store.rejectPendingApproval.mockReturnValueOnce(false);
    await expect(invoke('ax:reject', confirmation.approvalId)).rejects.toThrow('already being processed');
    expect(core.runtime.discardToolDraft).not.toHaveBeenCalled();
    expect(core.store.finishExecution).not.toHaveBeenCalled();
  });
});
