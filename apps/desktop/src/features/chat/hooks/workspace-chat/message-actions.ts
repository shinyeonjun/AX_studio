import type { WorkspaceChatMessageContext, WorkspaceSendResponse } from './contracts';
import type { WorkspaceChatMessage } from '@ax-studio/core';
import type { WorkspaceWorkflowState } from '../workspace-chat-helpers';
import { ipcErrorMessage } from '../../../../ui/lib/ipc-error';

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
      ctx.setProgress('답변을 준비하고 있습니다');
    }
    let savedSessionId = originSessionId;
    let responseReceived = false;
    let finalMessages: WorkspaceChatMessage[] | undefined;
    let finalTranscriptSaved = false;
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
        text,
        requestId,
        originWorkflowId,
        initialSaved.id,
      )) as WorkspaceSendResponse;
      responseReceived = true;
      finalMessages = [
        ...nextMessages,
        {
          role: 'assistant',
          content: res.content,
          ...(res.inputContinuation ? { inputContinuation: res.inputContinuation } : {}),
          ...(res.inputRequests?.length ? { inputRequests: res.inputRequests } : {}),
          ...(res.presentations?.length ? { presentations: res.presentations } : {}),
          ...(res.readResult ? { readResult: res.readResult } : {}),
        },
      ];
      if (ctx.isCurrentSession(epoch) && ctx.isViewingSession(savedSessionId)) {
        ctx.setChatMessages(finalMessages);
      }
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
      finalTranscriptSaved = true;
      savedSessionId = saved.id;
      ctx.onSessionsChanged?.();
      if (!ctx.isCurrentSession(epoch) && ctx.isViewingSession(savedSessionId)) {
        ctx.refs.pendingWorkspaceChatRefreshRef.current = savedSessionId;
      }
      if (ctx.isCurrentSession(epoch) && ctx.isViewingSession(savedSessionId)) {
        ctx.setChatMessages(saved.messages);
        ctx.refs.workspaceSessionIdRef.current = saved.id;
        ctx.setWorkspaceSessionId(saved.id);
        if (changedWorkflowId) {
          const workflow = await window.ax.loadWorkChat(changedWorkflowId);
          if (!ctx.isCurrentSession(epoch) || !ctx.isViewingSession(savedSessionId)) return;
          if (!workflow) throw new Error('workflow_missing_after_save');
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
        const errorMessage = ipcErrorMessage(err, '대화 처리에 실패했습니다.');
        ctx.setError(responseReceived && !finalTranscriptSaved
          ? `${errorMessage} 응답은 받았지만 대화 저장에 실패했습니다. 외부 작업 요청이었다면 이미 실행됐을 수 있으니, 중복 실행 전에 연결된 서비스 상태를 확인해 주세요.`
          : errorMessage);
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
