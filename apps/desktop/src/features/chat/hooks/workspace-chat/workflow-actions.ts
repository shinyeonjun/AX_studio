import type { WorkspaceChatMessageContext } from './contracts';
import { ipcErrorMessage } from '../../../../ui/lib/ipc-error';
import type { ToolResultConfirmation } from '@ax-studio/core';

export function createWorkspaceWorkflowActions(ctx: WorkspaceChatMessageContext) {
  const registerWorkflow = async () => {
    const workflowId = ctx.workspaceWorkflowState?.workflowId;
    // Not gated on the switch remembered when the chat opened: it may have been turned off since.
    if (!workflowId || ctx.refs.busyRef.current) return;
    const epoch = ctx.refs.sessionEpochRef.current;
    const sessionId = ctx.refs.workspaceSessionIdRef.current;
    ctx.setError('');
    try {
      await window.ax.setWorkflowActive(workflowId, true);
      if (ctx.isCurrentSession(epoch) && ctx.isViewingSession(sessionId)) ctx.setWorkflowRegistered(true);
      await ctx.refresh();
    } catch (err) {
      if (ctx.isCurrentSession(epoch) && ctx.isViewingSession(sessionId)) {
        ctx.setError(ipcErrorMessage(err, '대화 처리에 실패했습니다.'));
      }
    }
  };

  const resolveChatApproval = async (approvalId: string, action: 'approve' | 'reject') => {
    const sessionId = ctx.refs.workspaceSessionIdRef.current;
    if (!sessionId) throw new Error('승인 대상 대화를 찾을 수 없습니다.');
    try {
      if (action === 'approve') await window.ax.approve(approvalId);
      else await window.ax.reject(approvalId);
    } catch (err) {
      throw new Error(ipcErrorMessage(err, action === 'approve' ? '승인에 실패했습니다.' : '취소에 실패했습니다.'));
    }
    try {
      await ctx.refresh();
      await ctx.refreshMappedWorkspaceChat(sessionId);
    } catch {
      if (ctx.isViewingSession(sessionId)) ctx.setError('처리는 완료됐습니다. 화면을 새로 불러오지 못했습니다.');
    }
  };

  const approveChatApproval = (approvalId: string) => resolveChatApproval(approvalId, 'approve');
  const confirmToolResult = async (confirmation: ToolResultConfirmation) => {
    const sessionId = ctx.refs.workspaceSessionIdRef.current;
    if (sessionId !== confirmation.workspaceSessionId) throw new Error('대화가 변경되었습니다.');
    const result = await window.ax.confirmToolResult(confirmation);
    try {
      await (ctx.refreshAfterAction ?? ctx.refresh)();
      const refreshed = await ctx.refreshMappedWorkspaceChat(sessionId);
      return refreshed === false ? { ...result, refreshWarning: true } : result;
    } catch {
      // Provider outcome is authoritative even when presentation refresh fails.
      return { ...result, refreshWarning: true };
    }
  };
  const rejectChatApproval = (approvalId: string) => resolveChatApproval(approvalId, 'reject');

  return {
    registerWorkflow,
    approveChatApproval,
    rejectChatApproval,
    confirmToolResult,
  };
}
