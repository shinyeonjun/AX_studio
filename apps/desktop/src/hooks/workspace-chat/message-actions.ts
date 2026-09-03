import type { WorkspaceChatMessageContext, WorkspaceSendResponse } from './contracts';
import type { WorkspaceChatMessage } from '@ax-studio/core';
import type { WorkspaceWorkflowState } from '../workspace-chat-helpers';
import { ipcErrorMessage } from '../../lib/ipc-error';

export function createWorkspaceMessageActions(ctx: WorkspaceChatMessageContext) {
  const sendChat = async (text: string) => {
    if (ctx.refs.busyRef.current) return;
    const epoch = ctx.refs.sessionEpochRef.current;
    const requestId = crypto.randomUUID();
    const originSessionId = ctx.refs.workspaceSessionIdRef.current;
    const originWorkflowId = ctx.workspaceWorkflowState?.workflowId;
    ctx.refs.busyRef.current = true;
    ctx.refs.activeRequestIdRef.current = requestId;
    const nextMessages: WorkspaceChatMessage[] = [
      ...ctx.chatMessages,
      { role: 'user', content: text },
    ];
    if (ctx.isCurrentSession(epoch)) {
      ctx.setChatMessages(nextMessages);
      ctx.setBusy(true);
      ctx.setError('');
      ctx.setProgress('연결된 리소스를 확인하고 있습니다');
    }
    let savedSessionId = originSessionId;
    try {
      const initialSaved = await window.ax.saveWorkspaceChat(
        originSessionId,
        nextMessages,
        originWorkflowId,
      );
      savedSessionId = initialSaved.id;
      if (ctx.isCurrentSession(epoch) && ctx.isViewingSession(originSessionId)) {
        ctx.refs.workspaceSessionIdRef.current = initialSaved.id;
        ctx.setWorkspaceSessionId(initialSaved.id);
      }
      const res = (await window.ax.sendCommandChat(
        nextMessages,
        requestId,
        originWorkflowId,
        initialSaved.id,
      )) as WorkspaceSendResponse;
      const finalMessages: WorkspaceChatMessage[] = [
        ...nextMessages,
        {
          role: 'assistant',
          content: res.content,
          ...(res.inputRequests?.length ? { inputRequests: res.inputRequests } : {}),
          ...(res.presentations?.length ? { presentations: res.presentations } : {}),
        },
      ];
      const changedWorkflowId = res.changedWorkflowIds?.[0];
      const removedWorkflowId = originWorkflowId &&
        res.removedWorkflowIds?.includes(originWorkflowId)
        ? originWorkflowId
        : undefined;
      const workflowId = removedWorkflowId ? null : changedWorkflowId ?? originWorkflowId;
      const saved = await window.ax.saveWorkspaceChat(
        savedSessionId,
        finalMessages,
        workflowId,
      );
      savedSessionId = saved.id;
      ctx.onSessionsChanged?.();
      if (ctx.isViewingSession(savedSessionId)) {
        ctx.setChatMessages(saved.messages);
        ctx.refs.workspaceSessionIdRef.current = saved.id;
        ctx.setWorkspaceSessionId(saved.id);
        const sourceResult = await window.ax.listWorkspaceSources(saved.id);
        ctx.setWorkspaceSources(sourceResult.sources);
        if (changedWorkflowId) {
          const workflow = await window.ax.loadWorkChat(changedWorkflowId);
          const state: WorkspaceWorkflowState = {
            ...(workflow.state as WorkspaceWorkflowState),
            summary: workflow.summary,
            title: workflow.title,
            workflowId: changedWorkflowId,
            messages: saved.messages,
          };
          ctx.setWorkspaceWorkflowState(state);
          ctx.setWorkflowRegistered(workflow.active === true);
          await ctx.refresh();
        } else if ((res.removedWorkflowIds?.length ?? 0) > 0) {
          if (removedWorkflowId) ctx.setWorkspaceWorkflowState(null);
          await ctx.refresh();
        }
      }
    } catch (err) {
      if (ctx.isCurrentSession(epoch) && ctx.isViewingSession(savedSessionId)) {
        ctx.setError(ipcErrorMessage(err, '대화 처리에 실패했습니다.'));
      }
    } finally {
      if (ctx.refs.activeRequestIdRef.current === requestId) {
        ctx.refs.activeRequestIdRef.current = undefined;
        ctx.refs.busyRef.current = false;
      }
      if (ctx.isCurrentSession(epoch)) {
        ctx.setBusy(false);
        ctx.setProgress('');
      }
      const pendingSessionId = ctx.refs.pendingWorkspaceChatRefreshRef.current;
      if (
        pendingSessionId &&
        !ctx.refs.busyRef.current &&
        ctx.isCurrentSession(epoch) &&
        ctx.isViewingSession(pendingSessionId)
      ) {
        ctx.refs.pendingWorkspaceChatRefreshRef.current = undefined;
        void ctx.refreshMappedWorkspaceChat(pendingSessionId);
      }
    }
  };

  const sendMessage = async (rawText: string) => {
    const text = rawText.trim();
    if (!text || ctx.refs.busyRef.current) return;
    ctx.setError('');
    await sendChat(text);
  };

  return { sendMessage };
}
