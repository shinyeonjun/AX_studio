import type { WorkspaceWorkflowContext } from './contracts';
import { ipcErrorMessage } from '../../../../ui/lib/ipc-error';

export function createWorkspaceWorkflowActions(ctx: WorkspaceWorkflowContext) {
  const registerWorkflow = async () => {
    const workflowId = ctx.workspaceWorkflowState?.workflowId;
    if (!workflowId || ctx.refs.busyRef.current || ctx.workflowRegistered) return;
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
      await ctx.refresh();
      await ctx.refreshMappedWorkspaceChat(sessionId);
    } catch (err) {
      throw new Error(ipcErrorMessage(err, action === 'approve' ? '승인에 실패했습니다.' : '취소에 실패했습니다.'));
    }
  };

  const approveChatApproval = (approvalId: string) => resolveChatApproval(approvalId, 'approve');
  const rejectChatApproval = (approvalId: string) => resolveChatApproval(approvalId, 'reject');

  return {
    registerWorkflow,
    approveChatApproval,
    rejectChatApproval,
  };
}
