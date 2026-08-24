import { useEffect, useRef, useState } from 'react';
import {
  hydrateWorkflowSummary,
  workspaceChatErrorMessage,
  type WorkspaceWorkflowState,
} from './workspace-chat-helpers';
import type { WorkspaceChatMessage } from '../components/workspace/AxWorkspaceChat';
import type { WorkspaceSourceRecord } from '@ax-studio/core';

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

  useEffect(() => {
    const off = window.ax.onChatProgress?.(({ message, requestId }) => {
      const activeRequestId = activeRequestIdRef.current;
      if (!activeRequestId || (requestId && requestId !== activeRequestId)) return;
      setProgress(message);
    });
    return () => off?.();
  }, []);

  const isCurrentSession = (epoch: number) => epoch === sessionEpochRef.current;

  const invalidateSession = () => {
    sessionEpochRef.current += 1;
  };

  const cancelActiveRequest = () => {
    const requestId = activeRequestIdRef.current;
    activeRequestIdRef.current = undefined;
    busyRef.current = false;
    setBusy(false);
    if (requestId) void window.ax.cancelChat(requestId).catch(() => undefined);
  };

  const reset = () => {
    cancelActiveRequest();
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
  };

  const displayMessages: WorkspaceChatMessage[] = chatMessages;

  const startNewChat = () => {
    reset();
  };

  const loadWorkspaceChat = async (id: string) => {
    cancelActiveRequest();
    invalidateSession();
    const epoch = sessionEpochRef.current;
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
        const state = await hydrateWorkflowSummary({
          ...(workflow.state as WorkspaceWorkflowState),
          summary: workflow.summary,
          title: workflow.title,
          workflowId: loaded.workflowId,
          messages: loaded.messages,
        });
        setWorkspaceWorkflowState(state);
      }
    } catch (err) {
      if (!isCurrentSession(epoch)) return;
      setError(workspaceChatErrorMessage(err));
    } finally {
      if (isCurrentSession(epoch)) setBusy(false);
    }
  };

  const openWorkChat = async (workflowId: string) => {
    cancelActiveRequest();
    invalidateSession();
    const epoch = sessionEpochRef.current;
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
      const state = await hydrateWorkflowSummary({
        ...(loaded.state as WorkspaceWorkflowState),
        summary: loaded.summary,
        title: loaded.title,
        workflowId,
        messages: mappedChat?.messages,
      });
      if (!isCurrentSession(epoch)) return;
      if (!mappedChat) setChatMessages(state.messages ?? []);
      setWorkspaceWorkflowState(state);
    } catch (err) {
      if (!isCurrentSession(epoch)) return;
      setError(workspaceChatErrorMessage(err));
    } finally {
      if (isCurrentSession(epoch)) setBusy(false);
    }
  };

  const sendChat = async (text: string) => {
    if (busyRef.current || sourceBusyRef.current) return;
    const epoch = sessionEpochRef.current;
    const requestId = crypto.randomUUID();
    busyRef.current = true;
    activeRequestIdRef.current = requestId;
    const nextMessages: WorkspaceChatMessage[] = [...chatMessages, { role: 'user', content: text }];
    const currentWorkflowId = workspaceWorkflowState?.workflowId;
    setChatMessages(nextMessages);
    setBusy(true);
    setError('');
    setProgress('연결된 리소스를 확인하고 있습니다');
    try {
      const initialSaved = await window.ax.saveWorkspaceChat(
        workspaceSessionIdRef.current,
        nextMessages,
        currentWorkflowId,
      );
      if (!isCurrentSession(epoch)) return;
      workspaceSessionIdRef.current = initialSaved.id;
      setWorkspaceSessionId(initialSaved.id);
      onSessionsChanged?.();
      const res = (await window.ax.sendCommandChat(
        nextMessages,
        requestId,
        currentWorkflowId,
        initialSaved.id,
      )) as {
        role: 'assistant';
        content: string;
        changedWorkflowIds?: string[];
        removedWorkflowIds?: string[];
        inputRequests?: import('@ax-studio/core').AxInputRequest[];
        presentations?: import('@ax-studio/core').AxUiPresentation[];
      };
      if (!isCurrentSession(epoch)) return;
      const finalMessages: WorkspaceChatMessage[] = [
        ...nextMessages,
        {
          role: 'assistant',
          content: res.content,
          ...(res.inputRequests?.length ? { inputRequests: res.inputRequests } : {}),
          ...(res.presentations?.length ? { presentations: res.presentations } : {}),
        },
      ];
      setChatMessages(finalMessages);
      const changedWorkflowId = res.changedWorkflowIds?.[0];
      const removedWorkflowId = workspaceWorkflowState?.workflowId &&
        res.removedWorkflowIds?.includes(workspaceWorkflowState.workflowId)
        ? workspaceWorkflowState.workflowId
        : undefined;
      const workflowId = removedWorkflowId ? null : changedWorkflowId ?? workspaceWorkflowState?.workflowId;
      const saved = await window.ax.saveWorkspaceChat(
        workspaceSessionIdRef.current,
        finalMessages,
        workflowId,
      );
      if (!isCurrentSession(epoch)) return;
      workspaceSessionIdRef.current = saved.id;
      setWorkspaceSessionId(saved.id);
      onSessionsChanged?.();
      const sourceResult = await window.ax.listWorkspaceSources(saved.id);
      if (!isCurrentSession(epoch)) return;
      setWorkspaceSources(sourceResult.sources);
      if (changedWorkflowId) {
        const workflow = await window.ax.loadWorkChat(changedWorkflowId);
        if (!isCurrentSession(epoch)) return;
        const state = await hydrateWorkflowSummary({
          ...(workflow.state as WorkspaceWorkflowState),
          summary: workflow.summary,
          title: workflow.title,
          workflowId: changedWorkflowId,
          messages: finalMessages,
        });
        setWorkspaceWorkflowState(state);
        await refresh();
      } else if ((res.removedWorkflowIds?.length ?? 0) > 0) {
        if (removedWorkflowId) setWorkspaceWorkflowState(null);
        await refresh();
      }
    } catch (err) {
      if (!isCurrentSession(epoch)) return;
      setError(workspaceChatErrorMessage(err));
    } finally {
      if (activeRequestIdRef.current === requestId) {
        activeRequestIdRef.current = undefined;
        busyRef.current = false;
      }
      if (isCurrentSession(epoch)) {
        setBusy(false);
        setProgress('');
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
      setError(workspaceChatErrorMessage(err));
    }
  };

  const sendMessage = async (rawText: string) => {
    const text = rawText.trim();
    if (!text || busyRef.current) return;
    setError('');
    await sendChat(text);
  };

  const beginEditStep = (prompt: string) => {
    setEditHint(prompt);
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
      setError(workspaceChatErrorMessage(err));
    }
  };

  const attachWorkspaceSource = async () => {
    if (sourceBusyRef.current || busyRef.current) return;
    sourceBusyRef.current = true;
    setSourceBusy(true);
    setError('');
    try {
      let sessionId = workspaceSessionIdRef.current;
      if (!sessionId) {
        const saved = await window.ax.saveWorkspaceChat(
          undefined,
          chatMessages,
          workspaceWorkflowState?.workflowId,
        );
        sessionId = saved.id;
        workspaceSessionIdRef.current = sessionId;
        setWorkspaceSessionId(sessionId);
        onSessionsChanged?.();
      }
      const result = await window.ax.attachWorkspaceSource(sessionId);
      if (!result.ok) {
        if (result.error) setError(result.error);
        return;
      }
      setWorkspaceSources((current) => [
        ...current.filter((source) => source.id !== result.source.id),
        result.source,
      ]);
      await refreshWorkspaceSources(sessionId);
    } catch (err) {
      setError(workspaceChatErrorMessage(err));
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
    progress,
    reset,
    startNewChat,
    loadWorkspaceChat,
    workspaceSessionId,
    openWorkChat,
    workflowRegistered,
    registerWorkflow,
    sendMessage,
    workspaceSources,
    sourceBusy,
    attachWorkspaceSource,
    refreshWorkspaceSources,
  };
}
