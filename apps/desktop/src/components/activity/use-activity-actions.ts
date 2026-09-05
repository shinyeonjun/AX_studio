import { useState } from 'react';
import type { AppState } from '../../types/app-state';
import { confirmDeleteExecution } from '../../lib/confirm-delete';
import { ipcErrorMessage } from '../../lib/ipc-error';

export interface ActivityActionsInput {
  state: AppState | null;
  onRefresh: () => Promise<void>;
}

export function useActivityActions({ state, onRefresh }: ActivityActionsInput) {
  const [explainQ, setExplainQ] = useState('실행이 멈췄거나 실패한 이유를 물어보세요');
  const [explainA, setExplainA] = useState('');
  const [explainError, setExplainError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  const [explaining, setExplaining] = useState(false);
  const [exportingId, setExportingId] = useState<string | null>(null);
  const [exportedId, setExportedId] = useState<string | null>(null);
  const [exportError, setExportError] = useState<{ executionId: string; message: string } | null>(null);
  const [savingToFolderId, setSavingToFolderId] = useState<string | null>(null);
  const [savedToFolderId, setSavedToFolderId] = useState<string | null>(null);
  const [folderSaveError, setFolderSaveError] = useState<{ executionId: string; message: string } | null>(null);

  const executions = state?.executions ?? [];
  const canExplain = executions.length > 0;

  const askExplain = async () => {
    if (!canExplain) return;
    setExplaining(true);
    setExplainError('');
    try {
      setExplainA(await window.ax.explain(explainQ));
    } catch (err) {
      setExplainError(ipcErrorMessage(err, '실행 기록을 분석하지 못했습니다.'));
    } finally {
      setExplaining(false);
    }
  };

  const deleteExecution = async (executionId: string) => {
    if (!confirmDeleteExecution()) return;
    setBusyId(executionId);
    try {
      await window.ax.deleteExecution(executionId);
      await onRefresh();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : '기록을 삭제하지 못했습니다.');
    } finally {
      setBusyId(null);
    }
  };

  const clearExecutions = async () => {
    const count = state?.executions?.length ?? 0;
    if (count === 0) return;
    if (!window.confirm(`실행 기록 ${count}건을 지울까요?\n승인 대기 중인 실행은 남겨둡니다.`)) return;
    setClearing(true);
    try {
      await window.ax.clearExecutions();
      await onRefresh();
    } finally {
      setClearing(false);
    }
  };

  const exportPdf = async (executionId: string, artifactId: string) => {
    setExportingId(executionId);
    setExportedId(null);
    setExportError(null);
    try {
      const result = await window.ax.exportGeneratedArtifact(artifactId);
      if (!result.ok) {
        if (!result.canceled) {
          setExportError({
            executionId,
            message: result.error ?? 'PDF를 저장하지 못했습니다.',
          });
        }
        return;
      }
      setExportedId(executionId);
    } catch (err) {
      setExportError({ executionId, message: ipcErrorMessage(err, 'PDF를 저장하지 못했습니다.') });
    } finally {
      setExportingId(null);
    }
  };

  const savePdfToFolder = async (executionId: string, artifactId: string) => {
    setSavingToFolderId(executionId);
    setSavedToFolderId(null);
    setFolderSaveError(null);
    try {
      const result = await window.ax.saveGeneratedArtifactToFolder(artifactId);
      if (!result.ok) {
        if (!result.canceled) {
          setFolderSaveError({
            executionId,
            message: result.error ?? 'PDF를 지정 폴더에 저장하지 못했습니다.',
          });
        }
        return;
      }
      setSavedToFolderId(executionId);
    } catch (err) {
      setFolderSaveError({
        executionId,
        message: ipcErrorMessage(err, 'PDF를 지정 폴더에 저장하지 못했습니다.'),
      });
    } finally {
      setSavingToFolderId(null);
    }
  };

  return {
    executions,
    canExplain,
    explainQ,
    setExplainQ,
    explainA,
    explainError,
    busyId,
    clearing,
    explaining,
    exportingId,
    exportedId,
    exportError,
    savingToFolderId,
    savedToFolderId,
    folderSaveError,
    askExplain,
    deleteExecution,
    clearExecutions,
    exportPdf,
    savePdfToFolder,
  };
}
