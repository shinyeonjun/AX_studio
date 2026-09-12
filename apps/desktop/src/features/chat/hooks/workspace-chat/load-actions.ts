import type { WorkspaceChatContext } from './contracts';
import type { WorkspaceWorkflowState } from '../workspace-chat-helpers';
import { ipcErrorMessage } from '../../../../ui/lib/ipc-error';
import { beginSessionLoad, finishSessionLoad } from './lifecycle-actions';

export function createWorkspaceLoadActions(ctx: WorkspaceChatContext) {
  const refreshMappedWorkspaceChat = async (sessionId: string) => {
    const epoch = ctx.refs.sessionEpochRef.current;
    const sequence = ++ctx.refs.chatRefreshSequenceRef.current;
    const current = () => ctx.isCurrentSession(epoch) && ctx.isViewingSession(sessionId)
      && ctx.refs.chatRefreshSequenceRef.current === sequence;
    try {
      const loaded = await window.ax.loadWorkspaceChat(sessionId);
      if (!current()) return;
      if (ctx.refs.busyRef.current) {
        ctx.refs.pendingWorkspaceChatRefreshRef.current = sessionId;
        return;
      }
      ctx.setChatMessages(loaded.messages);
      ctx.setWorkspaceWorkflowState((current) =>
        current ? { ...current, messages: loaded.messages } : current,
      );
      ctx.onSessionsChanged?.();
    } catch (err) {
      if (current()) {
        ctx.setError(ipcErrorMessage(err, '실행 결과를 대화에 불러오지 못했습니다.'));
      }
    }
  };

  const loadWorkspaceChat = async (id: string) => {
    const epoch = beginSessionLoad(ctx);
    // Keep the intended conversation subscribed while its snapshot is in flight.
    // Result notifications received during the load are queued by the busy guard.
    ctx.refs.workspaceSessionIdRef.current = id;
    ctx.setWorkspaceSessionId(id);
    try {
      const loaded = await window.ax.loadWorkspaceChat(id);
      if (!ctx.isCurrentSession(epoch)) return;
      ctx.refs.workspaceSessionIdRef.current = loaded.id;
      ctx.setWorkspaceSessionId(loaded.id);
      ctx.setChatMessages(loaded.messages);
      const sourceResult = await window.ax.listWorkspaceSources(loaded.id);
      if (!ctx.isCurrentSession(epoch)) return;
      ctx.setWorkspaceSources(sourceResult.sources);
      if (loaded.workflowId) {
        const workflow = await window.ax.loadWorkChat(loaded.workflowId);
        if (!ctx.isCurrentSession(epoch)) return;
        const state: WorkspaceWorkflowState = {
          ...(workflow.state as WorkspaceWorkflowState),
          summary: workflow.summary,
          title: workflow.title,
          workflowId: loaded.workflowId,
          messages: loaded.messages,
        };
        ctx.setWorkspaceWorkflowState(state);
        ctx.setWorkflowRegistered(workflow.active === true);
      }
    } catch (err) {
      if (!ctx.isCurrentSession(epoch)) return;
      ctx.setError(ipcErrorMessage(err, '대화 처리에 실패했습니다.'));
    } finally {
      finishSessionLoad(ctx, epoch);
      if (ctx.isCurrentSession(epoch) && ctx.refs.pendingWorkspaceChatRefreshRef.current === id) {
        ctx.refs.pendingWorkspaceChatRefreshRef.current = undefined;
        void refreshMappedWorkspaceChat(id);
      }
    }
  };

  const openWorkChat = async (workflowId: string) => {
    const epoch = beginSessionLoad(ctx);
    try {
      const [mappedChat, loaded] = await Promise.all([
        window.ax.loadWorkspaceChatByWorkflowId(workflowId), window.ax.loadWorkChat(workflowId),
      ]);
      if (!ctx.isCurrentSession(epoch)) return;
      if (mappedChat) {
        ctx.refs.workspaceSessionIdRef.current = mappedChat.id;
        ctx.setWorkspaceSessionId(mappedChat.id);
        ctx.setChatMessages(mappedChat.messages);
        const sourceResult = await window.ax.listWorkspaceSources(mappedChat.id);
        if (!ctx.isCurrentSession(epoch)) return;
        ctx.setWorkspaceSources(sourceResult.sources);
      }
      const state: WorkspaceWorkflowState = {
        ...(loaded.state as WorkspaceWorkflowState),
        summary: loaded.summary,
        title: loaded.title,
        workflowId,
        messages: mappedChat?.messages,
      };
      if (!ctx.isCurrentSession(epoch)) return;
      if (!mappedChat) ctx.setChatMessages(state.messages ?? []);
      ctx.setWorkspaceWorkflowState(state);
      ctx.setWorkflowRegistered(loaded.active === true);
    } catch (err) {
      if (!ctx.isCurrentSession(epoch)) return;
      ctx.setError(ipcErrorMessage(err, '대화 처리에 실패했습니다.'));
    } finally {
      finishSessionLoad(ctx, epoch);
      const pending = ctx.refs.pendingWorkspaceChatRefreshRef.current;
      if (ctx.isCurrentSession(epoch) && pending && ctx.isViewingSession(pending)) {
        ctx.refs.pendingWorkspaceChatRefreshRef.current = undefined;
        void refreshMappedWorkspaceChat(pending);
      }
    }
  };

  return {
    refreshMappedWorkspaceChat,
    loadWorkspaceChat,
    openWorkChat,
  };
}
