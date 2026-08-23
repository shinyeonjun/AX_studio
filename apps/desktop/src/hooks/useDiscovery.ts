import { useCallback, useEffect, useState } from 'react';
import type { DiscoveryInspectView } from '@ax-studio/core';

type CommandResult<T> = {
  status: string;
  data?: T;
};

const TERMINAL_STATUSES = new Set(['published', 'failed', 'cancelled']);

function unwrap<T>(result: unknown): T | undefined {
  if (!result || typeof result !== 'object') return undefined;
  const envelope = result as CommandResult<T>;
  if (envelope.status === 'ok') return envelope.data;
  return undefined;
}

interface UseDiscoveryOptions {
  onPublished?: () => void | Promise<void>;
}

export function useDiscovery(options: UseDiscoveryOptions = {}) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [view, setView] = useState<DiscoveryInspectView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(async (id: string) => {
    const result = await window.ax.discoveryInspect(id);
    const data = unwrap<DiscoveryInspectView>(result);
    if (data) setView(data);
    return data ?? null;
  }, []);

  useEffect(() => {
    if (!sessionId) return;
    void refresh(sessionId);
    if (view && TERMINAL_STATUSES.has(view.status)) return;
    const timer = window.setInterval(() => {
      void refresh(sessionId);
    }, 1500);
    return () => window.clearInterval(timer);
  }, [refresh, sessionId, view?.status]);

  const startFromArtifact = useCallback(async (goal: string, artifactId: string) => {
    setBusy(true);
    setError('');
    try {
      const result = await window.ax.discoveryStart({
        goal,
        exampleArtifactIds: [artifactId],
        inputArtifactIds: [],
      });
      const data = unwrap<{ sessionId: string }>(result);
      if (!data?.sessionId) throw new Error('업무 발견을 시작하지 못했습니다.');
      setSessionId(data.sessionId);
      await refresh(data.sessionId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const importAndStart = useCallback(async (goal: string) => {
    setBusy(true);
    setError('');
    try {
      const imported = await window.ax.importArtifact();
      if (!imported.ok) {
        if ('error' in imported && imported.error) {
          throw new Error(imported.error);
        }
        return;
      }
      await startFromArtifact(goal, imported.artifact.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [startFromArtifact]);

  const answer = useCallback(async (questionId: string, optionId: string) => {
    if (!sessionId) return;
    setBusy(true);
    try {
      await window.ax.discoveryAnswer({ sessionId, questionId, optionId });
      await refresh(sessionId);
    } finally {
      setBusy(false);
    }
  }, [refresh, sessionId]);

  const answerQuestion = useCallback(async (optionId: string) => {
    if (!view?.pendingQuestion) return;
    await answer(view.pendingQuestion.id, optionId);
  }, [answer, view?.pendingQuestion]);

  const publish = useCallback(async (name?: string) => {
    if (!sessionId) return;
    setBusy(true);
    try {
      const result = await window.ax.discoveryPublish({ sessionId, name });
      const data = unwrap<{ workflowId?: string }>(result);
      await refresh(sessionId);
      if (data?.workflowId) await options.onPublished?.();
      return data?.workflowId;
    } finally {
      setBusy(false);
    }
  }, [options, refresh, sessionId]);

  return {
    sessionId,
    view,
    busy,
    error,
    importAndStart,
    answer,
    answerQuestion,
    publish,
  };
}
