import type { WorkspaceChatMessageContext, WorkspaceSendResponse } from './contracts';
import type { WorkspaceChatMessage, WorkspaceChatSaveOptions } from '@ax-studio/core';
import type { WorkspaceWorkflowState } from '../workspace-chat-helpers';
import { ipcErrorMessage } from '../../../../ui/lib/ipc-error';
import { publishWorkspaceTranscript, transcriptSnapshot } from './transcript-snapshot';

export function createWorkspaceMessageActions(ctx: WorkspaceChatMessageContext) {
  // Production context carries a single React state pair. Older isolated callers
  // capture their pair once here, before any refresh can advance the shared ref.
  const captured = ctx.transcriptSnapshot ?? transcriptSnapshot(ctx.chatMessages, ctx.refs.transcriptRevisionRef?.current);
  /**
   * One user turn: save the user line, get the reply, save the transcript. `reply` replaces the
   * Jev chat call for host-built turns (e.g. a recurring-job draft) so they share every
   * transcript-revision and session guard of an ordinary message.
   */
  const sendChat = async (
    text: string,
    metadataLane?: WorkspaceChatSaveOptions['metadataLane'],
    reply?: (sessionId: string) => Promise<WorkspaceSendResponse>,
  ) => {
    if (ctx.refs.busyRef.current) return;
    const epoch = ctx.refs.sessionEpochRef.current;
    const requestId = crypto.randomUUID();
    const originSessionId = ctx.refs.workspaceSessionIdRef.current;
    const originWorkflowId = ctx.workspaceWorkflowState?.workflowId;
    ctx.refs.busyRef.current = true;
    ctx.refs.activeRequestIdRef.current = requestId;
    const nextMessages: WorkspaceChatMessage[] = [
      ...captured.messages,
      { role: 'user', content: text, turnId: requestId },
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
    let initialTranscriptSaved = false;
    try {
      const saveOptions: WorkspaceChatSaveOptions = {
        ...(captured.transcriptRevision ? { expectedTranscriptRevision: captured.transcriptRevision } : {}),
        ...(metadataLane ? { metadataLane } : {}),
      };
      const initialSaved = await window.ax.saveWorkspaceChat(
        originSessionId,
        nextMessages,
        originWorkflowId,
        ...(Object.keys(saveOptions).length ? [saveOptions] : []),
      );
      initialTranscriptSaved = true;
      savedSessionId = initialSaved.id;
      ctx.refs.inFlightRepliesRef?.current.set(initialSaved.id, requestId);
      if (ctx.isCurrentSession(epoch) && ctx.isViewingSession(originSessionId)) {
        ctx.refs.workspaceSessionIdRef.current = initialSaved.id;
        publishWorkspaceTranscript(ctx, initialSaved);
        ctx.setWorkspaceSessionId(initialSaved.id);
      }
      const res = reply
        ? await reply(initialSaved.id)
        : (await window.ax.sendCommandChat(
          text,
          requestId,
          originWorkflowId,
          initialSaved.id,
          ...(metadataLane ? [{ metadataLane }] : []),
        )) as WorkspaceSendResponse;
      responseReceived = true;
      if (res.persistedReply) {
        const receipt = res.persistedReply;
        if (receipt.kind !== 'registered_http_metadata' || receipt.sessionId !== savedSessionId
          || receipt.requestId !== requestId || receipt.turnId !== requestId || res.requestId !== requestId
          || !receipt.transcriptRevision || !Number.isSafeInteger(receipt.requestGeneration) || receipt.requestGeneration < 1) {
          throw new Error('workspace_chat_persisted_reply_identity_conflict');
        }
        finalTranscriptSaved = true;
        const authoritative = await window.ax.loadWorkspaceChat(savedSessionId);
        if (authoritative.id !== savedSessionId) throw new Error('workspace_chat_persisted_reply_identity_conflict');
        ctx.onSessionsChanged?.();
        if (ctx.isCurrentSession(epoch) && ctx.isViewingSession(savedSessionId)) {
          publishWorkspaceTranscript(ctx, authoritative);
        } else if (ctx.isViewingSession(savedSessionId)) {
          ctx.refs.pendingWorkspaceChatRefreshRef.current = savedSessionId;
        }
        return;
      }
      if (res.metadataStop && ['cancelled', 'conflict', 'duplicate_request', 'turn_not_admitted'].includes(res.metadataStop)) {
        throw new Error('workspace_chat_revision_conflict');
      }
      finalMessages = [
        ...nextMessages,
        {
          role: 'assistant',
          content: res.content,
          ...(res.inputContinuation ? { inputContinuation: res.inputContinuation } : {}),
          ...(res.inputRequests?.length ? { inputRequests: res.inputRequests } : {}),
          ...(res.presentations?.length ? { presentations: res.presentations } : {}),
          ...(res.readResult ? { readResult: res.readResult, ...(res.readRepeatable ? { readRepeatable: true } : {}) } : {}),
          ...(res.dbConnection ? { dbConnection: res.dbConnection } : {}),
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
        ...(initialSaved.transcriptRevision ? [{ expectedTranscriptRevision: initialSaved.transcriptRevision }] : []),
      );
      finalTranscriptSaved = true;
      savedSessionId = saved.id;
      ctx.onSessionsChanged?.();
      if (!ctx.isCurrentSession(epoch) && ctx.isViewingSession(savedSessionId)) {
        ctx.refs.pendingWorkspaceChatRefreshRef.current = savedSessionId;
      }
      if (ctx.isCurrentSession(epoch) && ctx.isViewingSession(savedSessionId)) {
        publishWorkspaceTranscript(ctx, saved);
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
      const conflict = ipcErrorMessage(err).includes('workspace_chat_revision_conflict')
        || ipcErrorMessage(err).includes('workspace_chat_turn_conflict')
        || ipcErrorMessage(err).includes('workspace_chat_persisted_reply_identity_conflict');
      if (conflict) {
        if (!initialTranscriptSaved && ctx.isCurrentSession(epoch) && ctx.isViewingSession(savedSessionId)) ctx.setEditHint(text);
        try {
          if (savedSessionId) {
            const authoritative = await window.ax.loadWorkspaceChat(savedSessionId);
            if (ctx.isCurrentSession(epoch) && ctx.isViewingSession(savedSessionId)) {
              publishWorkspaceTranscript(ctx, authoritative);
            }
          }
        } catch { /* Keep the input and conflict visible; never retry a snapshot or command. */ }
      }
      if (ctx.isCurrentSession(epoch) && ctx.isViewingSession(savedSessionId)) {
        const errorMessage = ipcErrorMessage(err, '대화 처리에 실패했습니다.');
        ctx.setError(conflict ? '다른 창에서 대화가 바뀌어 저장하지 않았어요. 화면을 새로 고쳐 주세요.'
          + (!initialTranscriptSaved ? ' 저장되지 않은 새 입력은 위에 보관했습니다.' : '')
          + ' 작업은 자동으로 다시 실행하지 않았어요.' : responseReceived && !finalTranscriptSaved
          ? `${errorMessage} 응답은 받았지만 대화 저장에 실패했습니다. 외부 작업 요청이었다면 이미 실행됐을 수 있으니, 중복 실행 전에 연결된 서비스 상태를 확인해 주세요.`
          : errorMessage);
      }
    } finally {
      const inFlight = ctx.refs.inFlightRepliesRef?.current;
      if (savedSessionId && inFlight?.get(savedSessionId) === requestId) inFlight.delete(savedSessionId);
      if (ctx.refs.activeRequestIdRef.current === requestId) {
        // Also true after returning to this chat while it was still answering.
        ctx.refs.activeRequestIdRef.current = undefined;
        ctx.refs.busyRef.current = false;
        ctx.setBusy(false);
        ctx.setProgress('');
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

  const sendMessage = async (rawText: string, options?: Pick<WorkspaceChatSaveOptions, 'metadataLane'>) => {
    const text = rawText.trim();
    if (!text || ctx.refs.busyRef.current) return;
    ctx.setError('');
    await sendChat(text, options?.metadataLane);
  };

  /**
   * Turns a finished one-off run of this conversation into a recurring-job draft on the chosen
   * schedule. The host reuses the steps that ran; the draft still needs "저장하고 켜기".
   */
  const makeRecurring = async (source: { executionId: string } | { latestRead: true }, scheduleValue: string) => {
    if (ctx.refs.busyRef.current || !scheduleValue) return;
    ctx.setError('');
    await sendChat(
      `이 작업을 반복 업무로 만들기: ${scheduleValue}`,
      undefined,
      (sessionId) => ('executionId' in source
        ? window.ax.proposeRecurringFromExecution(sessionId, source.executionId, scheduleValue)
        : window.ax.proposeRecurringFromRead(sessionId, scheduleValue)) as Promise<WorkspaceSendResponse>,
    );
  };

  return { sendMessage, makeRecurring };
}
