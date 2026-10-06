import { useCallback } from 'react';
import { ipcErrorMessage } from '../../../../ui/lib/ipc-error';
import { commandError, unwrap } from './result.js';
import type { UseDiscoveryStartActionsOptions } from './contracts.js';

export function useDiscoveryStartActions({
  workspaceContextKeyRef,
  operationEpochRef,
  activeSessionRef,
  setSessionId,
  setSessionContextKey,
  setBusy,
  setError,
  refresh,
}: UseDiscoveryStartActionsOptions) {
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
        // Best effort: the stale session is abandoned either way.
        void window.ax.discoveryCancel(data.sessionId).catch(() => undefined);
        return;
      }
      activeSessionRef.current = data.sessionId;
      setSessionId(data.sessionId);
      setSessionContextKey(contextKey);
      await refresh(data.sessionId, epoch);
    } catch (err) {
      if (epoch === operationEpochRef.current) setError(ipcErrorMessage(err));
    } finally {
      if (epoch === operationEpochRef.current) setBusy(false);
    }
  }, [activeSessionRef, operationEpochRef, refresh, setBusy, setError, setSessionContextKey, setSessionId, workspaceContextKeyRef]);

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
      if (epoch === operationEpochRef.current) setError(ipcErrorMessage(err));
    } finally {
      if (epoch === operationEpochRef.current) setBusy(false);
    }
  }, [operationEpochRef, setBusy, setError, startFromArtifact, workspaceContextKeyRef]);

  return {
    importAndStart,
    startFromArtifact,
  };
}
