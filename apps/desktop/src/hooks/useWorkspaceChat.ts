import { useEffect, useRef, useState } from 'react';
import { parseWorkspaceCommand } from '../lib/parse-slash-command';
import {
  hydrateWorkflowSummary,
  workspaceChatErrorMessage,
  type WorkspaceWorkflowState,
} from './workspace-chat-helpers';
import type { WorkspaceExecutionMode } from '@ax-studio/core';
import type { WorkspaceChatMessage } from '../components/workspace/AxWorkspaceChat';

export type { WorkspaceWorkflowState } from './workspace-chat-helpers';

export interface UseWorkspaceChatOptions {
  refresh: () => Promise<void>;
  onSessionsChanged?: () => void;
}

export function useWorkspaceChat({ refresh, onSessionsChanged }: UseWorkspaceChatOptions) {
  const sessionEpochRef = useRef(0);
  const workspaceSessionIdRef = useRef<string | undefined>(undefined);
  const [workspaceSessionId, setWorkspaceSessionId] = useState<string | undefined>();
  const [chatMessages, setChatMessages] = useState<WorkspaceChatMessage[]>([]);
  const [workspaceWorkflowState, setWorkspaceWorkflowState] = useState<WorkspaceWorkflowState | null>(null);
  const [workspaceExecutionMode, setWorkspaceExecutionMode] = useState<WorkspaceExecutionMode | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState('');
  const [editHint, setEditHint] = useState<string | null>(null);

  useEffect(() => {
    const off = window.ax.onChatProgress?.(({ message }) => setProgress(message));
    return () => off?.();
  }, []);

  const isCurrentSession = (epoch: number) => epoch === sessionEpochRef.current;

  const invalidateSession = () => {
    sessionEpochRef.current += 1;
  };

  const reset = () => {
    invalidateSession();
    workspaceSessionIdRef.current = undefined;
    setWorkspaceSessionId(undefined);
    setWorkspaceWorkflowState(null);
    setWorkspaceExecutionMode(undefined);
    setChatMessages([]);
    setBusy(false);
    setError('');
    setProgress('');
    setEditHint(null);
  };

  const displayMessages: WorkspaceChatMessage[] = chatMessages;

  const startNewChat = () => {
    reset();
  };

  const loadWorkspaceChat = async (id: string) => {
    invalidateSession();
    const epoch = sessionEpochRef.current;
    setBusy(true);
    setError('');
    setWorkspaceWorkflowState(null);
    try {
      const loaded = await window.ax.loadWorkspaceChat(id);
      if (!isCurrentSession(epoch)) return;
      workspaceSessionIdRef.current = loaded.id;
      setWorkspaceSessionId(loaded.id);
      setChatMessages(loaded.messages);
      setWorkspaceExecutionMode(loaded.executionMode);
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
    invalidateSession();
    const epoch = sessionEpochRef.current;
    setBusy(true);
    setError('');
    setChatMessages([]);
    setWorkspaceWorkflowState(null);
    setWorkspaceExecutionMode(undefined);
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
        setWorkspaceExecutionMode(mappedChat.executionMode);
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

  const sendChat = async (text: string, mode = workspaceExecutionMode) => {
    const epoch = sessionEpochRef.current;
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
        mode,
      );
      if (!isCurrentSession(epoch)) return;
      workspaceSessionIdRef.current = initialSaved.id;
      setWorkspaceSessionId(initialSaved.id);
      setWorkspaceExecutionMode(mode);
      onSessionsChanged?.();
      const res = (await window.ax.sendCommandChat(
        nextMessages,
        undefined,
        currentWorkflowId,
        mode,
      )) as {
        role: 'assistant';
        content: string;
        changedWorkflowIds?: string[];
        removedWorkflowIds?: string[];
      };
      if (!isCurrentSession(epoch)) return;
      const finalMessages: WorkspaceChatMessage[] = [
        ...nextMessages,
        { role: 'assistant', content: res.content },
      ];
      setChatMessages(finalMessages);
      const changedWorkflowId = res.changedWorkflowIds?.[0];
      const removedWorkflowId = workspaceWorkflowState?.workflowId &&
        res.removedWorkflowIds?.includes(workspaceWorkflowState.workflowId)
        ? workspaceWorkflowState.workflowId
        : undefined;
      const workflowId = removedWorkflowId ? undefined : changedWorkflowId ?? workspaceWorkflowState?.workflowId;
      const saved = await window.ax.saveWorkspaceChat(
        workspaceSessionIdRef.current,
        finalMessages,
        workflowId,
        mode,
      );
      if (!isCurrentSession(epoch)) return;
      workspaceSessionIdRef.current = saved.id;
      setWorkspaceSessionId(saved.id);
      setWorkspaceExecutionMode(saved.executionMode ?? mode);
      onSessionsChanged?.();
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
      if (isCurrentSession(epoch)) {
        setBusy(false);
        setProgress('');
      }
    }
  };

  const sendMessage = async (rawText: string) => {
    const text = rawText.trim();
    if (!text || busy) return;
    setError('');

    const command = parseWorkspaceCommand(text);
    if (command.mode === 'once') {
      if (!command.instruction) {
        setError('/once 뒤에 실행할 업무를 입력해 주세요.');
        return;
      }
      await sendChat(command.instruction, 'once');
      return;
    }
    if (command.mode === 'workflow') {
      if (!command.instruction) {
        setError('/workflow 뒤에 자동화할 업무를 입력해 주세요.');
        return;
      }
      await sendChat(command.instruction, 'workflow');
      return;
    }
    await sendChat(command.text, workspaceExecutionMode);
  };

  const beginEditStep = (prompt: string) => {
    setEditHint(prompt);
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
    sendMessage,
  };
}
