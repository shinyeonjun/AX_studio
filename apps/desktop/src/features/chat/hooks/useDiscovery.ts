import { useCallback, useEffect, useRef, useState } from 'react';
import { ipcErrorMessage } from '../../../ui/lib/ipc-error';
import type { DiscoveryInspectView } from '@ax-studio/core';
import { TERMINAL_STATUSES, WAITING_FOR_PERSON_STATUSES, commandError, unwrap } from './use-discovery/result.js';
import { useDiscoveryActions } from './use-discovery/actions.js';
import { CoalescedRefresh } from '../../../app/hooks/coalesced-refresh.js';

interface UseDiscoveryOptions {
  /** Changes whenever the visible Workspace chat context changes, including a new blank chat. */
  workspaceContextKey?: number;
  onPublished?: (workflowId: string) => void | Promise<void>;
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
  const refreshQueue = useRef(new CoalescedRefresh<DiscoveryInspectView | null>());
  const workspaceContextKeyRef = useRef(workspaceContextKey);
  const previousContextKeyRef = useRef(workspaceContextKey);
  workspaceContextKeyRef.current = workspaceContextKey;

  const clearState = useCallback(() => {
    operationEpochRef.current += 1;
    refreshEpochRef.current += 1;
    refreshQueue.current.clearPending();
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

  const refresh = useCallback((id: string, epoch = operationEpochRef.current, background = false) => {
    const refreshEpoch = background ? refreshEpochRef.current : ++refreshEpochRef.current;
    return refreshQueue.current.run(async () => {
    if (epoch !== operationEpochRef.current || activeSessionRef.current !== id) return null;
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
        setError(ipcErrorMessage(err));
      }
    }
    return null;
    });
  }, []);

  useEffect(() => () => {
    operationEpochRef.current += 1;
    refreshEpochRef.current += 1;
    refreshQueue.current.clearPending();
  }, []);

  const activeSessionId = sessionContextKey === workspaceContextKey ? sessionId : null;

  // A blank chat offers to finish a discovery the person left (the app may have been closed).
  const [resumable, setResumable] = useState<Array<{ sessionId: string; goal: string; status: string }>>([]);
  useEffect(() => {
    if (activeSessionId) return;
    let current = true;
    void window.ax.discoveryResumable?.()
      .then((sessions) => { if (current) setResumable(sessions); })
      .catch(() => { if (current) setResumable([]); });
    return () => { current = false; };
  }, [activeSessionId, workspaceContextKey]);

  const resume = useCallback((resumeSessionId: string) => {
    // Work still running for the session left behind no longer owns `busy`; release it here.
    operationEpochRef.current += 1;
    setBusy(false);
    setError('');
    activeSessionRef.current = resumeSessionId;
    setSessionId(resumeSessionId);
    setSessionContextKey(workspaceContextKeyRef.current);
    void refresh(resumeSessionId);
  }, [refresh]);
  const activeView = sessionContextKey === workspaceContextKey ? view : null;

  useEffect(() => {
    if (!activeSessionId) return;
    void refresh(activeSessionId, undefined, true);
    if (activeView && TERMINAL_STATUSES.has(activeView.status)) return;
    // While it waits for the person (a question, or publish), only a chat turn moves it on:
    // check now and then instead of every 1.5s for as long as the chat stays open.
    const waiting = activeView !== null && WAITING_FOR_PERSON_STATUSES.has(activeView.status);
    const timer = window.setInterval(() => {
      void refresh(activeSessionId, undefined, true);
    }, waiting ? 10_000 : 1500);
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
    resumable: activeSessionId ? [] : resumable,
    resume,
    ...actions,
  };
}
