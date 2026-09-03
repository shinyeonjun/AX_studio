import { useCallback } from 'react';
import { assertOk, commandError, unwrap } from './result.js';
import type { UseDiscoverySessionActionsOptions } from './contracts.js';

export function useDiscoverySessionActions({
  operationEpochRef,
  activeSessionId,
  activeView,
  setBusy,
  setError,
  refresh,
  onPublished,
}: UseDiscoverySessionActionsOptions) {
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
  }, [activeSessionId, activeView?.revision, operationEpochRef, refresh, setBusy, setError]);

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
  }, [activeSessionId, activeView?.revision, onPublished, operationEpochRef, refresh, setBusy, setError]);

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
  }, [activeSessionId, operationEpochRef, refresh, setBusy, setError]);

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
  }, [activeSessionId, activeView?.revision, activeView?.status, operationEpochRef, refresh, setBusy, setError]);

  return {
    answer,
    answerQuestion,
    publish,
    cancel,
    retry,
  };
}
