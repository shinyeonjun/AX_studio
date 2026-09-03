import { useCallback, useEffect, useRef, useState } from 'react';
import type { DiscoveryInspectView } from '@ax-studio/core';
import { TERMINAL_STATUSES, commandError, unwrap, type RefreshDiscovery } from './use-discovery/result.js';
import { useDiscoveryActions } from './use-discovery/actions.js';

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
  const refreshEpochRef = useRef(0);
  const workspaceContextKeyRef = useRef(workspaceContextKey);
  const previousContextKeyRef = useRef(workspaceContextKey);
  workspaceContextKeyRef.current = workspaceContextKey;

  const clearState = useCallback(() => {
    operationEpochRef.current += 1;
    refreshEpochRef.current += 1;
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

  const refresh: RefreshDiscovery = useCallback(async (id: string, epoch = operationEpochRef.current) => {
    const refreshEpoch = ++refreshEpochRef.current;
    const isCurrent = () => (
      refreshEpoch === refreshEpochRef.current
      && epoch === operationEpochRef.current
      && activeSessionRef.current === id
    );
    try {
      const result = await window.ax.discoveryInspect(id);
      if (!isCurrent()) return null;
      const data = unwrap<DiscoveryInspectView>(result);
      if (data) {
        setView(data);
        return data;
      }
      setError(commandError(result, '업무 발견 상태를 불러오지 못했습니다.').message);
    } catch (err) {
      if (isCurrent()) {
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

  const actions = useDiscoveryActions({
    workspaceContextKeyRef,
    operationEpochRef,
    activeSessionRef,
    setSessionId,
    setSessionContextKey,
    activeSessionId,
    activeView,
    setBusy,
    setError,
    refresh,
    onPublished,
  });

  const dismissError = useCallback(() => {
    setError('');
  }, []);

  return {
    sessionId: activeSessionId,
    view: activeView,
    busy,
    error,
    dismissError,
    ...actions,
  };
}
