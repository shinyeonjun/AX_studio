import { useCallback, useEffect, useState } from 'react';
import type { AppState } from '../types/app-state';
import { ipcErrorMessage } from '../lib/ipc-error';

export type AppLoadState = 'loading' | 'ready' | 'error' | 'stale';

export function useAppState() {
  const [state, setState] = useState<AppState | null>(null);
  const [loadState, setLoadState] = useState<AppLoadState>('loading');
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    setLoadState((current) => (current === 'ready' || current === 'stale' ? 'stale' : 'loading'));
    try {
      const next = await window.ax.getState();
      setState(next as AppState);
      setLoadState('ready');
      setError('');
    } catch (err) {
      const message = ipcErrorMessage(err, '앱 상태를 불러오지 못했습니다.');
      setError(message);
      setLoadState((current) => (current === 'loading' ? 'error' : 'stale'));
    }
  }, []);

  useEffect(() => {
    void refresh();
    return window.ax.onStateChanged(() => {
      void refresh();
    });
  }, [refresh]);

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
