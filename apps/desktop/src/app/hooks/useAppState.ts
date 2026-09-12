import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppState } from '../../types/app-state';
import { ipcErrorMessage } from '../../ui/lib/ipc-error';
import { CoalescedRefresh } from './coalesced-refresh';

export type AppLoadState = 'loading' | 'ready' | 'error' | 'stale';

export function useAppState() {
  const refreshIdRef = useRef(0);
  const refreshQueue = useRef(new CoalescedRefresh<void>());
  const mounted = useRef(true);
  const [state, setState] = useState<AppState | null>(null);
  const [loadState, setLoadState] = useState<AppLoadState>('loading');
  const [error, setError] = useState('');

  const requestRefresh = useCallback((invalidate: boolean) => {
    const refreshId = invalidate ? ++refreshIdRef.current : refreshIdRef.current;
    return refreshQueue.current.run(async () => {
      if (!mounted.current || refreshId !== refreshIdRef.current) return;
      setLoadState((current) => (current === 'error' ? 'loading' : current));
      try {
        const next = await window.ax.getState();
        if (!mounted.current || refreshId !== refreshIdRef.current) return;
        setState(next as AppState);
        setLoadState('ready');
        setError('');
      } catch (err) {
        if (!mounted.current || refreshId !== refreshIdRef.current) return;
        const message = ipcErrorMessage(err, '앱 상태를 불러오지 못했습니다.');
        setError(message);
        setLoadState((current) => (current === 'loading' ? 'error' : 'stale'));
      }
    });
  }, []);
  const refresh = useCallback(() => requestRefresh(true), [requestRefresh]);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    const unsubscribe = window.ax.onStateChanged(() => {
      // Notifications request a follow-up read without starving the active read.
      void requestRefresh(false);
    });
    return () => {
      mounted.current = false;
      refreshIdRef.current += 1;
      refreshQueue.current.clearPending();
      unsubscribe();
    };
  }, [refresh, requestRefresh]);

  return {
    state,
    loadState,
    error,
    refresh,
    isLoading: loadState === 'loading',
    isStale: loadState === 'stale',
    hasError: loadState === 'error' || Boolean(error),
  };
};
