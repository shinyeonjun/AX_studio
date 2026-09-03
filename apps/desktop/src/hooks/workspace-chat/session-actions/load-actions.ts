import type { WorkspaceChatContext } from '../contracts';
import type { WorkspaceWorkflowState } from '../../workspace-chat-helpers';
import { ipcErrorMessage } from '../../../lib/ipc-error';
import { detachActiveRequest, invalidateSession } from './helpers';

export function createWorkspaceLoadActions(ctx: WorkspaceChatContext) {
  const refreshMappedWorkspaceChat = async (sessionId: string) => {
    try {
      const loaded = await window.ax.loadWorkspaceChat(sessionId);
      if (!ctx.isViewingSession(sessionId)) return;
      ctx.setChatMessages(loaded.messages);
      ctx.setWorkspaceWorkflowState((current) =>
        current ? { ...current, messages: loaded.messages } : current,
      );
      ctx.onSessionsChanged?.();
    } catch (err) {
      if (ctx.isViewingSession(sessionId)) {
        ctx.setError(ipcErrorMessage(err, '실행 결과를 대화에 불러오지 못했습니다.'));
      }
    }
  };

  const loadWorkspaceChat = async (id: string) => {
    ctx.setWorkspaceContextKey((current) => current + 1);
    detachActiveRequest(ctx);
    invalidateSession(ctx);
    const epoch = ctx.refs.sessionEpochRef.current;
    ctx.refs.pendingWorkspaceChatRefreshRef.current = undefined;
    ctx.setBusy(true);
    ctx.setError('');
    ctx.setWorkspaceWorkflowState(null);
    ctx.setWorkflowRegistered(false);
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
      if (ctx.isCurrentSession(epoch)) ctx.setBusy(false);
    }
  };

  const openWorkChat = async (workflowId: string) => {
    ctx.setWorkspaceContextKey((current) => current + 1);
    detachActiveRequest(ctx);
    invalidateSession(ctx);
    const epoch = ctx.refs.sessionEpochRef.current;
    ctx.refs.pendingWorkspaceChatRefreshRef.current = undefined;
    ctx.setBusy(true);
    ctx.setError('');
    ctx.setChatMessages([]);
    ctx.setWorkspaceSources([]);
    ctx.setWorkspaceWorkflowState(null);
    ctx.setWorkflowRegistered(false);
    ctx.refs.workspaceSessionIdRef.current = undefined;
    ctx.setWorkspaceSessionId(undefined);
    try {
      const mappedChat = await window.ax.loadWorkspaceChatByWorkflowId(workflowId);
      const loaded = await window.ax.loadWorkChat(workflowId);
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
      if (ctx.isCurrentSession(epoch)) ctx.setBusy(false);
    }
  };

  return {
    refreshMappedWorkspaceChat,
    loadWorkspaceChat,
    openWorkChat,
  };
}
