import { useCallback } from 'react';
import { ipcErrorMessage } from '../../../../ui/lib/ipc-error';
import { commandError, unwrap } from './result.js';
import type { UseDiscoveryStartActionsOptions } from './contracts.js';

/**
 * What a past result is called, from its file name, for the goal and the saved work's name:
 * "월간매출요약_2026-08.xlsx" -> "월간매출요약". The period and version numbers are dropped, since
 * the work makes every period's. Undefined when nothing but numbers is left.
 */
export function resultNameFromFile(fileName: string | undefined): string | undefined {
  if (!fileName) return undefined;
  const base = fileName.replace(/\.[^.]+$/, '');
  const name = base
    // A number with its unit (8월, 3분기) or its one-letter tag (v2, q3) names the period or version.
    .replace(/(?<![A-Za-z])[A-Za-z]?\d+\s*(년|월|일|분기|주차|차)?/g, ' ')
    .replace(/[_\-.()\[\]~]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return name || undefined;
}

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
  const startFromArtifact = useCallback(async (goal: string, artifactIds: readonly string[], expectedContextKey?: number) => {
    const contextKey = workspaceContextKeyRef.current;
    if (expectedContextKey !== undefined && expectedContextKey !== contextKey) return;
    const epoch = operationEpochRef.current;
    setBusy(true);
    setError('');
    try {
      const result = await window.ax.discoveryStart({
        goal,
        exampleArtifactIds: [...artifactIds],
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
      const resultName = resultNameFromFile(imported.artifact.fileName);
      const artifacts = imported.artifacts?.length ? imported.artifacts : [imported.artifact];
      await startFromArtifact(resultName ? `${resultName} 만들기` : goal, artifacts.map((artifact) => artifact.id), contextKey);
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
