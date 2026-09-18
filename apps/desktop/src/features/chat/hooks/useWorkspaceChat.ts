import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { WorkspaceWorkflowState } from './workspace-chat-helpers';
import type { WorkspaceChatMessage, WorkspaceSourceRecord } from '@ax-studio/core';
import type { WorkspaceChatContext } from './workspace-chat/contracts';
import { createWorkspaceMessageActions } from './workspace-chat/message-actions';
import { createWorkspaceLifecycleActions } from './workspace-chat/lifecycle-actions';
import { createWorkspaceLoadActions } from './workspace-chat/load-actions';
import { createWorkspaceSourceActions } from './workspace-chat/source-actions';
import { createWorkspaceWorkflowActions } from './workspace-chat/workflow-actions';

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

  const isCurrentSession = useCallback((epoch: number) => epoch === sessionEpochRef.current, []);
  const isViewingSession = useCallback(
    (sessionId: string | undefined) => workspaceSessionIdRef.current === sessionId,
    [],
  );
  const context = useMemo<WorkspaceChatContext>(() => ({
    refs: {
      sessionEpochRef,
      workspaceSessionIdRef,
      activeRequestIdRef,
      busyRef,
      sourceBusyRef,
      pendingWorkspaceChatRefreshRef,
    },
    chatMessages,
    workspaceWorkflowState,
    refresh,
    onSessionsChanged,
    isCurrentSession,
    isViewingSession,
    setWorkspaceContextKey,
    setWorkspaceSessionId,
    setChatMessages,
    setWorkspaceWorkflowState,
    setBusy,
    setError,
    setProgress,
    setEditHint,
    setWorkflowRegistered,
    workflowRegistered,
    setWorkspaceSources,
    setSourceBusy,
  }), [
    chatMessages,
    isCurrentSession,
    isViewingSession,
    onSessionsChanged,
    refresh,
    workflowRegistered,
    workspaceWorkflowState,
  ]);
  const lifecycleActions = useMemo(() => createWorkspaceLifecycleActions(context), [context]);
  const loadActions = useMemo(() => createWorkspaceLoadActions(context), [context]);
  const refreshMappedWorkspaceChatRef = useRef(loadActions.refreshMappedWorkspaceChat);

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

  useEffect(() => {
    refreshMappedWorkspaceChatRef.current = loadActions.refreshMappedWorkspaceChat;
  }, [loadActions.refreshMappedWorkspaceChat]);

  useEffect(() => {
    const off = window.ax.onWorkspaceChatChanged?.(({ sessionId }) => {
      if (!isViewingSession(sessionId)) return;
      if (busyRef.current) {
        pendingWorkspaceChatRefreshRef.current = sessionId;
        return;
      }
      void refreshMappedWorkspaceChatRef.current(sessionId);
    });
    return () => off?.();
  }, [isViewingSession]);

  const messageActions = useMemo(() => createWorkspaceMessageActions({
    ...context,
    refreshMappedWorkspaceChat: loadActions.refreshMappedWorkspaceChat,
  }), [context, loadActions.refreshMappedWorkspaceChat]);
  const workflowActions = useMemo(() => createWorkspaceWorkflowActions({
    ...context,
    refreshMappedWorkspaceChat: loadActions.refreshMappedWorkspaceChat,
  }), [context, loadActions.refreshMappedWorkspaceChat]);
  const sourceActions = useMemo(() => createWorkspaceSourceActions(context), [context]);

  const beginEditStep = useCallback((prompt: string) => {
    setEditHint(prompt);
  }, []);

  const dismissError = useCallback(() => {
    setError('');
  }, []);

  const downloadGeneratedPdf = useCallback(async (artifactId: string) => {
    return window.ax.exportGeneratedArtifact(artifactId);
  }, []);

  const saveGeneratedPdfToFolder = useCallback(async (artifactId: string) => {
    return window.ax.saveGeneratedArtifactToFolder(artifactId);
  }, []);

  return {
    workspaceWorkflowState,
    displayMessages: chatMessages,
    editHint,
    setEditHint,
    beginEditStep,
    busy,
    error,
    dismissError,
    progress,
    reset: lifecycleActions.reset,
    startNewChat: lifecycleActions.startNewChat,
    loadWorkspaceChat: loadActions.loadWorkspaceChat,
    workspaceSessionId,
    workspaceContextKey,
    openWorkChat: loadActions.openWorkChat,
    workflowRegistered,
    registerWorkflow: workflowActions.registerWorkflow,
    sendMessage: messageActions.sendMessage,
    approveChatApproval: workflowActions.approveChatApproval,
    rejectChatApproval: workflowActions.rejectChatApproval,
    downloadGeneratedPdf,
    saveGeneratedPdfToFolder,
    workspaceSources,
    sourceBusy,
    attachWorkspaceSource: sourceActions.attachWorkspaceSource,
    refreshWorkspaceSources: sourceActions.refreshWorkspaceSources,
  };
}
