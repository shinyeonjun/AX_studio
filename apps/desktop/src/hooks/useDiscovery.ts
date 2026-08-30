import { useCallback, useEffect, useRef, useState } from 'react';
import type { DiscoveryInspectView } from '@ax-studio/core';

type CommandResult<T> = {
  status: string;
  data?: T;
  issues?: Array<{ message?: string; code?: string }>;
};

const TERMINAL_STATUSES = new Set(['published', 'failed', 'cancelled', 'needs_attention']);

function envelope<T>(result: unknown): CommandResult<T> | undefined {
  if (!result || typeof result !== 'object') return undefined;
  return result as CommandResult<T>;
}

function commandError(result: unknown, fallback: string): Error {
  const value = envelope(result);
  const message = value?.issues?.find((entry) => typeof entry.message === 'string' && entry.message.trim())?.message;
  return new Error(message ?? fallback);
}

function unwrap<T>(result: unknown): T | undefined {
  const value = envelope<T>(result);
  if (value?.status === 'ok') return value.data;
  return undefined;
}

function assertOk(result: unknown, fallback: string): void {
  if (envelope(result)?.status !== 'ok') throw commandError(result, fallback);
}

interface UseDiscoveryOptions {
  /** Changes whenever the visible Workspace chat context changes, including a new blank chat. */
  workspaceContextKey?: number;
  onPublished?: () => void | Promise<void>;
}

export function useDiscovery(options: UseDiscoveryOptions = {}) {
  const workspaceContextKey = options.workspaceContextKey ?? 0;
  const { onPublished } = options;
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionContextKey, setSessionContextKey] = useState<number | null>(null);
  const [view, setView] = useState<DiscoveryInspectView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const activeSessionRef = useRef<string | null>(null);
  const operationEpochRef = useRef(0);
  const workspaceContextKeyRef = useRef(workspaceContextKey);
  const previousContextKeyRef = useRef(workspaceContextKey);
  workspaceContextKeyRef.current = workspaceContextKey;

  const clearState = useCallback(() => {
    operationEpochRef.current += 1;
    activeSessionRef.current = null;
    setSessionId(null);
    setSessionContextKey(null);
    setView(null);
    setBusy(false);
    setError('');
  }, []);

  useEffect(() => {
    if (previousContextKeyRef.current === workspaceContextKey) return;
    previousContextKeyRef.current = workspaceContextKey;
    clearState();
  }, [clearState, workspaceContextKey]);

  const refresh = useCallback(async (id: string, epoch = operationEpochRef.current) => {
    try {
      const result = await window.ax.discoveryInspect(id);
      if (epoch !== operationEpochRef.current || activeSessionRef.current !== id) return null;
      const data = unwrap<DiscoveryInspectView>(result);
      if (data) {
        setView(data);
        return data;
      }
      setError(commandError(result, '업무 발견 상태를 불러오지 못했습니다.').message);
    } catch (err) {
      if (epoch === operationEpochRef.current && activeSessionRef.current === id) {
        setError(err instanceof Error ? err.message : String(err));
      }
    }
    return null;
  }, []);

  const activeSessionId = sessionContextKey === workspaceContextKey ? sessionId : null;
  const activeView = sessionContextKey === workspaceContextKey ? view : null;

  useEffect(() => {
    if (!activeSessionId) return;
    void refresh(activeSessionId);
    if (activeView && TERMINAL_STATUSES.has(activeView.status)) return;
    const timer = window.setInterval(() => {
      void refresh(activeSessionId);
    }, 1500);
    return () => window.clearInterval(timer);
  }, [activeSessionId, activeView?.status, refresh]);

  const startFromArtifact = useCallback(async (goal: string, artifactId: string, expectedContextKey?: number) => {
    const contextKey = workspaceContextKeyRef.current;
    if (expectedContextKey !== undefined && expectedContextKey !== contextKey) return;
    const epoch = operationEpochRef.current;
    setBusy(true);
    setError('');
    try {
      const result = await window.ax.discoveryStart({
        goal,
        exampleArtifactIds: [artifactId],
        inputArtifactIds: [],
      });
      const data = unwrap<{ sessionId: string }>(result);
      if (!data?.sessionId) throw commandError(result, '업무 발견을 시작하지 못했습니다.');
      if (epoch !== operationEpochRef.current || contextKey !== workspaceContextKeyRef.current) {
        void window.ax.discoveryCancel(data.sessionId);
        return;
      }
      activeSessionRef.current = data.sessionId;
      setSessionId(data.sessionId);
      setSessionContextKey(contextKey);
      await refresh(data.sessionId, epoch);
    } catch (err) {
      if (epoch === operationEpochRef.current) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (epoch === operationEpochRef.current) setBusy(false);
    }
  }, [refresh]);

  const importAndStart = useCallback(async (goal: string) => {
    const contextKey = workspaceContextKeyRef.current;
    const epoch = operationEpochRef.current;
    setBusy(true);
    setError('');
    try {
      const imported = await window.ax.importArtifact();
      if (epoch !== operationEpochRef.current || contextKey !== workspaceContextKeyRef.current) return;
      if (!imported.ok) {
        if ('error' in imported && imported.error) throw new Error(imported.error);
        return;
      }
      await startFromArtifact(goal, imported.artifact.id, contextKey);
    } catch (err) {
      if (epoch === operationEpochRef.current) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (epoch === operationEpochRef.current) setBusy(false);
    }
  }, [startFromArtifact]);

  const answer = useCallback(async (questionId: string, optionId: string) => {
    if (!activeSessionId || activeView?.revision === undefined) return;
    const epoch = operationEpochRef.current;
    setBusy(true);
    setError('');
    try {
      const result = await window.ax.discoveryAnswer({
        sessionId: activeSessionId,
        questionId,
        optionId,
        expectedRevision: activeView.revision,
      });
      assertOk(result, '선택한 답변을 반영하지 못했습니다.');
      await refresh(activeSessionId, epoch);
    } catch (err) {
      if (epoch === operationEpochRef.current) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (epoch === operationEpochRef.current) setBusy(false);
    }
  }, [activeSessionId, activeView?.revision, refresh]);

  const answerQuestion = useCallback(async (optionId: string) => {
    if (!activeView?.pendingQuestion) return;
    await answer(activeView.pendingQuestion.id, optionId);
  }, [activeView?.pendingQuestion, answer]);

  const publish = useCallback(async (name?: string) => {
    if (!activeSessionId || activeView?.revision === undefined) return;
    const epoch = operationEpochRef.current;
    setBusy(true);
    setError('');
    try {
      const result = await window.ax.discoveryPublish({
        sessionId: activeSessionId,
        name,
        expectedRevision: activeView.revision,
      });
      const data = unwrap<{ workflowId?: string }>(result);
      if (!data) throw commandError(result, '업무를 저장하지 못했습니다.');
      await refresh(activeSessionId, epoch);
      if (data.workflowId && epoch === operationEpochRef.current) await onPublished?.();
      return data.workflowId;
    } catch (err) {
      if (epoch === operationEpochRef.current) setError(err instanceof Error ? err.message : String(err));
      return undefined;
    } finally {
      if (epoch === operationEpochRef.current) setBusy(false);
    }
  }, [activeSessionId, activeView?.revision, onPublished, refresh]);

  const cancel = useCallback(async () => {
    if (!activeSessionId) return;
    const epoch = operationEpochRef.current;
    setBusy(true);
    setError('');
    try {
      const result = await window.ax.discoveryCancel(activeSessionId);
      assertOk(result, '업무 발견을 취소하지 못했습니다.');
      await refresh(activeSessionId, epoch);
    } catch (err) {
      if (epoch === operationEpochRef.current) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (epoch === operationEpochRef.current) setBusy(false);
    }
  }, [activeSessionId, refresh]);

  const retry = useCallback(async () => {
    if (!activeSessionId || activeView?.status !== 'needs_attention') return;
    const epoch = operationEpochRef.current;
    setBusy(true);
    setError('');
    try {
      const result = await window.ax.discoveryRetry({
        sessionId: activeSessionId,
        expectedRevision: activeView.revision,
      });
      assertOk(result, '업무 발견을 다시 시도하지 못했습니다.');
      await refresh(activeSessionId, epoch);
    } catch (err) {
      if (epoch === operationEpochRef.current) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (epoch === operationEpochRef.current) setBusy(false);
    }
  }, [activeSessionId, activeView?.revision, activeView?.status, refresh]);

  const dismissError = useCallback(() => {
    setError('');
  }, []);

  return {
    sessionId: activeSessionId,
    view: activeView,
    busy,
    error,
    dismissError,
    importAndStart,
    answer,
    answerQuestion,
    publish,
    cancel,
    retry,
  };
}
