import { useCallback, useEffect, useState } from 'react';
import type { AppState } from '../types/app-state';

export function useAppState() {
  const [state, setState] = useState<AppState | null>(null);

  const refresh = useCallback(async () => {
    const next = await window.ax.getState();
    setState(next as AppState);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { state, refresh };
}
