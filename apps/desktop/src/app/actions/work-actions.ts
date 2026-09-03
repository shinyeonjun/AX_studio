import { confirmDeleteWork } from '../../lib/confirm-delete';
import { ipcErrorMessage } from '../../lib/ipc-error';
import type { AppWorkActionContext } from './contracts';

export function createAppWorkActions({
  workspaceChat,
  refresh,
  refreshSessions,
  setActiveSessionId,
  setSidebarTab,
  setActionError,
}: AppWorkActionContext) {
  const openWork = async (workflowId: string) => {
    setSidebarTab('work');
    setActiveSessionId(undefined);
    await workspaceChat.openWorkChat(workflowId);
    await refreshSessions();
  };

  const deleteWork = async (workflowId: string, name: string) => {
    if (!confirmDeleteWork(name)) return;

    const isActiveWorkspaceWorkflow = workspaceChat.workspaceWorkflowState?.workflowId === workflowId;

    setActionError('');
    try {
      await window.ax.deleteWorkflow(workflowId);

      if (isActiveWorkspaceWorkflow) {
        workspaceChat.startNewChat();
        setActiveSessionId(undefined);
      }

      await refresh();
      await refreshSessions();
    } catch (err) {
      setActionError(ipcErrorMessage(err, '업무를 삭제하지 못했습니다.'));
    }
  };

  return { openWork, deleteWork };
}
