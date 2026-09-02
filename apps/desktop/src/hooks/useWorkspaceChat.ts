import { useEffect, useRef, useState } from 'react';
import type { WorkspaceWorkflowState } from './workspace-chat-helpers';
import { ipcErrorMessage } from '../lib/ipc-error';
import type { WorkspaceChatMessage, WorkspaceSourceRecord } from '@ax-studio/core';

export type { WorkspaceWorkflowState } from './workspace-chat-helpers';

export interface UseWorkspaceChatOptions {
  refresh: () => Promise<void>;
  onSessionsChanged?: () => void;
}

export function useWorkspaceChat({ refresh, onSessionsChanged }: UseWorkspaceChatOptions) {
  const sessionEpochRef = useRef(0);
  const workspaceSessionIdRef = useRef<string | undefined>(undefined);
  const activeRequestIdRef = useRef<string | undefined>(undefined);
  const busyRef = useRef(false);
  const [workspaceSessionId, setWorkspaceSessionId] = useState<string | undefined>();
  const [workspaceContextKey, setWorkspaceContextKey] = useState(0);
  const [chatMessages, setChatMessages] = useState<WorkspaceChatMessage[]>([]);
  const [workspaceWorkflowState, setWorkspaceWorkflowState] = useState<WorkspaceWorkflowState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState('');
  const [editHint, setEditHint] = useState<string | null>(null);
  const [workflowRegistered, setWorkflowRegistered] = useState(false);
  const [workspaceSources, setWorkspaceSources] = useState<WorkspaceSourceRecord[]>([]);
  const [sourceBusy, setSourceBusy] = useState(false);
  const sourceBusyRef = useRef(false);
  const pendingWorkspaceChatRefreshRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    const off = window.ax.onChatProgress?.(({ message, requestId }) => {
      const activeRequestId = activeRequestIdRef.current;
      if (!activeRequestId || (requestId && requestId !== activeRequestId)) return;
      setProgress(message);
    });
    return () => off?.();
  }, []);

  useEffect(() => {
    const off = window.ax.onWorkspaceSourceChanged?.(({ sessionId, source }) => {
      if (workspaceSessionIdRef.current !== sessionId) return;
      setWorkspaceSources((current) => [
        ...current.filter((entry) => entry.id !== source.id),
        source,
      ]);
    });
    return () => off?.();
  }, []);

  const isCurrentSession = (epoch: number) => epoch === sessionEpochRef.current;

  const isViewingSession = (sessionId: string | undefined) =>
    workspaceSessionIdRef.current === sessionId;

  const refreshMappedWorkspaceChat = async (sessionId: string) => {
    try {
      const loaded = await window.ax.loadWorkspaceChat(sessionId);
      if (!isViewingSession(sessionId)) return;
      setChatMessages(loaded.messages);
      setWorkspaceWorkflowState((current) =>
        current ? { ...current, messages: loaded.messages } : current,
      );
      onSessionsChanged?.();
    } catch (err) {
      if (isViewingSession(sessionId)) {
        setError(ipcErrorMessage(err, '실행 결과를 대화에 불러오지 못했습니다.'));
      }
    }
  };

  useEffect(() => {
    const off = window.ax.onWorkspaceChatChanged?.(({ sessionId }) => {
      if (!isViewingSession(sessionId)) return;
      if (busyRef.current) {
        pendingWorkspaceChatRefreshRef.current = sessionId;
        return;
      }
      void refreshMappedWorkspaceChat(sessionId);
    });
    return () => off?.();
  }, [onSessionsChanged]);

  const invalidateSession = () => {
    sessionEpochRef.current += 1;
  };

  const detachActiveRequest = () => {
    activeRequestIdRef.current = undefined;
    busyRef.current = false;
    setBusy(false);
    setProgress('');
  };

  const reset = () => {
    setWorkspaceContextKey((current) => current + 1);
    detachActiveRequest();
    invalidateSession();
    workspaceSessionIdRef.current = undefined;
    setWorkspaceSessionId(undefined);
    setWorkspaceWorkflowState(null);
    setChatMessages([]);
    setBusy(false);
    setError('');
    setProgress('');
    setEditHint(null);
    setWorkflowRegistered(false);
    setWorkspaceSources([]);
    setSourceBusy(false);
    sourceBusyRef.current = false;
    pendingWorkspaceChatRefreshRef.current = undefined;
  };

  const displayMessages: WorkspaceChatMessage[] = chatMessages;

  const startNewChat = () => {
    reset();
  };

  const loadWorkspaceChat = async (id: string) => {
    setWorkspaceContextKey((current) => current + 1);
    detachActiveRequest();
    invalidateSession();
    const epoch = sessionEpochRef.current;
    pendingWorkspaceChatRefreshRef.current = undefined;
    setBusy(true);
    setError('');
    setWorkspaceWorkflowState(null);
    setWorkflowRegistered(false);
    try {
      const loaded = await window.ax.loadWorkspaceChat(id);
      if (!isCurrentSession(epoch)) return;
      workspaceSessionIdRef.current = loaded.id;
      setWorkspaceSessionId(loaded.id);
      setChatMessages(loaded.messages);
      const sourceResult = await window.ax.listWorkspaceSources(loaded.id);
      if (!isCurrentSession(epoch)) return;
      setWorkspaceSources(sourceResult.sources);
      if (loaded.workflowId) {
        const workflow = await window.ax.loadWorkChat(loaded.workflowId);
        if (!isCurrentSession(epoch)) return;
        const state: WorkspaceWorkflowState = {
          ...(workflow.state as WorkspaceWorkflowState),
          summary: workflow.summary,
          title: workflow.title,
          workflowId: loaded.workflowId,
          messages: loaded.messages,
        };
        setWorkspaceWorkflowState(state);
        setWorkflowRegistered(workflow.active === true);
      }
    } catch (err) {
      if (!isCurrentSession(epoch)) return;
      setError(ipcErrorMessage(err, '대화 처리에 실패했습니다.'));
    } finally {
      if (isCurrentSession(epoch)) setBusy(false);
    }
  };

  const openWorkChat = async (workflowId: string) => {
    setWorkspaceContextKey((current) => current + 1);
    detachActiveRequest();
    invalidateSession();
    const epoch = sessionEpochRef.current;
    pendingWorkspaceChatRefreshRef.current = undefined;
    setBusy(true);
    setError('');
    setChatMessages([]);
    setWorkspaceSources([]);
    setWorkspaceWorkflowState(null);
    setWorkflowRegistered(false);
    workspaceSessionIdRef.current = undefined;
    setWorkspaceSessionId(undefined);
    try {
      const mappedChat = await window.ax.loadWorkspaceChatByWorkflowId(workflowId);
      const loaded = await window.ax.loadWorkChat(workflowId);
      if (!isCurrentSession(epoch)) return;
      if (mappedChat) {
        workspaceSessionIdRef.current = mappedChat.id;
        setWorkspaceSessionId(mappedChat.id);
        setChatMessages(mappedChat.messages);
        const sourceResult = await window.ax.listWorkspaceSources(mappedChat.id);
        if (!isCurrentSession(epoch)) return;
        setWorkspaceSources(sourceResult.sources);
      }
      const state: WorkspaceWorkflowState = {
        ...(loaded.state as WorkspaceWorkflowState),
        summary: loaded.summary,
        title: loaded.title,
        workflowId,
        messages: mappedChat?.messages,
      };
      if (!isCurrentSession(epoch)) return;
      if (!mappedChat) setChatMessages(state.messages ?? []);
      setWorkspaceWorkflowState(state);
      setWorkflowRegistered(loaded.active === true);
    } catch (err) {
      if (!isCurrentSession(epoch)) return;
      setError(ipcErrorMessage(err, '대화 처리에 실패했습니다.'));
    } finally {
      if (isCurrentSession(epoch)) setBusy(false);
    }
  };

  const sendChat = async (text: string) => {
    if (busyRef.current) return;
    const epoch = sessionEpochRef.current;
    const requestId = crypto.randomUUID();
    const originSessionId = workspaceSessionIdRef.current;
    const originWorkflowId = workspaceWorkflowState?.workflowId;
    busyRef.current = true;
    activeRequestIdRef.current = requestId;
    const nextMessages: WorkspaceChatMessage[] = [...chatMessages, { role: 'user', content: text }];
    if (isCurrentSession(epoch)) {
      setChatMessages(nextMessages);
      setBusy(true);
      setError('');
      setProgress('연결된 리소스를 확인하고 있습니다');
    }
    let savedSessionId = originSessionId;
    try {
      const initialSaved = await window.ax.saveWorkspaceChat(
        originSessionId,
        nextMessages,
        originWorkflowId,
      );
      savedSessionId = initialSaved.id;
      if (isCurrentSession(epoch) && isViewingSession(originSessionId)) {
        workspaceSessionIdRef.current = initialSaved.id;
        setWorkspaceSessionId(initialSaved.id);
      }
      const res = (await window.ax.sendCommandChat(
        nextMessages,
        requestId,
        originWorkflowId,
        initialSaved.id,
      )) as {
        role: 'assistant';
        content: string;
        changedWorkflowIds?: string[];
        removedWorkflowIds?: string[];
        inputRequests?: import('@ax-studio/core').AxInputRequest[];
        presentations?: import('@ax-studio/core').AxUiPresentation[];
      };
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
      onSessionsChanged?.();
      if (isViewingSession(savedSessionId)) {
        setChatMessages(saved.messages);
        workspaceSessionIdRef.current = saved.id;
        setWorkspaceSessionId(saved.id);
        const sourceResult = await window.ax.listWorkspaceSources(saved.id);
        setWorkspaceSources(sourceResult.sources);
        if (changedWorkflowId) {
          const workflow = await window.ax.loadWorkChat(changedWorkflowId);
          const state: WorkspaceWorkflowState = {
            ...(workflow.state as WorkspaceWorkflowState),
            summary: workflow.summary,
            title: workflow.title,
            workflowId: changedWorkflowId,
            messages: saved.messages,
          };
          setWorkspaceWorkflowState(state);
          setWorkflowRegistered(workflow.active === true);
          await refresh();
        } else if ((res.removedWorkflowIds?.length ?? 0) > 0) {
          if (removedWorkflowId) setWorkspaceWorkflowState(null);
          await refresh();
        }
      }
    } catch (err) {
      if (isCurrentSession(epoch) && isViewingSession(savedSessionId)) {
        setError(ipcErrorMessage(err, '대화 처리에 실패했습니다.'));
      }
    } finally {
      if (activeRequestIdRef.current === requestId) {
        activeRequestIdRef.current = undefined;
        busyRef.current = false;
      }
      if (isCurrentSession(epoch)) {
        setBusy(false);
        setProgress('');
      }
      const pendingSessionId = pendingWorkspaceChatRefreshRef.current;
      if (
        pendingSessionId &&
        !busyRef.current &&
        isCurrentSession(epoch) &&
        isViewingSession(pendingSessionId)
      ) {
        pendingWorkspaceChatRefreshRef.current = undefined;
        void refreshMappedWorkspaceChat(pendingSessionId);
      }
    }
  };

  const registerWorkflow = async () => {
    const workflowId = workspaceWorkflowState?.workflowId;
    if (!workflowId || busyRef.current || workflowRegistered) return;
    setError('');
    try {
      await window.ax.setWorkflowActive(workflowId, true);
      setWorkflowRegistered(true);
      await refresh();
    } catch (err) {
      setError(ipcErrorMessage(err, '대화 처리에 실패했습니다.'));
    }
  };

  const sendMessage = async (rawText: string) => {
    const text = rawText.trim();
    if (!text || busyRef.current) return;
    setError('');
    await sendChat(text);
  };

  const resolveChatApproval = async (approvalId: string, action: 'approve' | 'reject') => {
    const sessionId = workspaceSessionIdRef.current;
    if (!sessionId) throw new Error('승인 대상 대화를 찾을 수 없습니다.');
    try {
      if (action === 'approve') await window.ax.approve(approvalId);
      else await window.ax.reject(approvalId);
      await refresh();
      await refreshMappedWorkspaceChat(sessionId);
    } catch (err) {
      throw new Error(ipcErrorMessage(err, action === 'approve' ? '승인에 실패했습니다.' : '취소에 실패했습니다.'));
    }
  };

  const approveChatApproval = (approvalId: string) => resolveChatApproval(approvalId, 'approve');
  const rejectChatApproval = (approvalId: string) => resolveChatApproval(approvalId, 'reject');

  const beginEditStep = (prompt: string) => {
    setEditHint(prompt);
  };

  const dismissError = () => {
    setError('');
  };

  const refreshWorkspaceSources = async (sessionId = workspaceSessionIdRef.current) => {
    if (!sessionId) {
      setWorkspaceSources([]);
      return;
    }
    try {
      const result = await window.ax.listWorkspaceSources(sessionId);
      if (workspaceSessionIdRef.current === sessionId) setWorkspaceSources(result.sources);
    } catch (err) {
      setError(ipcErrorMessage(err, '대화 처리에 실패했습니다.'));
    }
  };

  const attachWorkspaceSource = async () => {
    if (sourceBusyRef.current || busyRef.current) return;
    sourceBusyRef.current = true;
    setSourceBusy(true);
    setError('');
    try {
      const result = await window.ax.attachWorkspaceSource(workspaceSessionIdRef.current);
      if (!result.ok) {
        if (result.error) setError(result.error);
        return;
      }
      workspaceSessionIdRef.current = result.sessionId;
      setWorkspaceSessionId(result.sessionId);
      setWorkspaceSources((current) => [
        ...current.filter((source) => source.id !== result.source.id),
        result.source,
      ]);
      await refreshWorkspaceSources(result.sessionId);
      onSessionsChanged?.();
    } catch (err) {
      setError(ipcErrorMessage(err, '대화 처리에 실패했습니다.'));
    } finally {
      sourceBusyRef.current = false;
      setSourceBusy(false);
    }
  };

  return {
    workspaceWorkflowState,
    displayMessages,
    editHint,
    setEditHint,
    beginEditStep,
    busy,
    error,
    dismissError,
    progress,
    reset,
    startNewChat,
    loadWorkspaceChat,
    workspaceSessionId,
    workspaceContextKey,
    openWorkChat,
    workflowRegistered,
    registerWorkflow,
    sendMessage,
    approveChatApproval,
    rejectChatApproval,
    workspaceSources,
    sourceBusy,
    attachWorkspaceSource,
    refreshWorkspaceSources,
  };
}
