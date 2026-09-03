import { confirmDeleteChat } from '../../lib/confirm-delete';
import { ipcErrorMessage } from '../../lib/ipc-error';
import type { AppSessionActionContext } from './contracts';
import type { ChatSessionSummary } from '../../hooks/useChatSessions';

export function createAppSessionActions({
  activeSessionId,
  workspaceChat,
  refreshSessions,
  setActiveSessionId,
  setSidebarTab,
  setActionError,
}: AppSessionActionContext) {
  const startNewChat = () => {
    workspaceChat.startNewChat();
    setActiveSessionId(undefined);
    setSidebarTab('work');
  };

  const selectSession = async (session: ChatSessionSummary) => {
    setSidebarTab('work');
    setActiveSessionId(session.id);
    await workspaceChat.loadWorkspaceChat(session.id);
  };

  const deleteSession = async (session: ChatSessionSummary) => {
    if (!confirmDeleteChat(session.title)) return;

    const isActive =
      activeSessionId === session.id ||
      workspaceChat.workspaceSessionId === session.id ||
      (session.workflowId && workspaceChat.workspaceWorkflowState?.workflowId === session.workflowId);

    setActionError('');
    try {
      await window.ax.deleteWorkspaceChat(session.id);

      if (isActive) {
        workspaceChat.startNewChat();
        setActiveSessionId(undefined);
      }

      await refreshSessions();
    } catch (err) {
      setActionError(ipcErrorMessage(err, '대화를 삭제하지 못했습니다.'));
    }
  };

  return { startNewChat, selectSession, deleteSession };
}
