import { useEffect, useRef, useState } from 'react';
import type { InterviewDraft } from '@ax-studio/core/workflow-schema';
import type { CompletenessResult } from '@ax-studio/core/requiredness';
import { shouldRunWorkflowAfterSave } from '../lib/work-display';
import {
  appendAssistantMessage,
  cloneInterviewDraft,
  draftTrigger,
  emptyInterviewDraftBaseline,
  hydrateInterviewSummary,
  interviewErrorMessage,
  interviewSessionTitle,
  isAffirmativeRunIntent,
  isDeferredOnce,
  isImmediateOnce,
  isRecurringDraft,
  isRunConfirmationMessage,
  type InterviewState,
} from './interview-helpers';

export type { InterviewState } from './interview-helpers';
export { isDeferredOnce, isImmediateOnce, isRecurringDraft } from './interview-helpers';

export interface UseInterviewOptions {
  refresh: () => Promise<void>;
}

export function useInterview({ refresh }: UseInterviewOptions) {
  const sessionEpochRef = useRef(0);
  const savedWorkflowIdRef = useRef<string | undefined>();
  const actionInFlightRef = useRef(false);
  const [composerText, setComposerText] = useState('');
  const [interview, setInterview] = useState<InterviewState | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState('');
  const [editHint, setEditHint] = useState<string | null>(null);
  const [workflowBaseline, setWorkflowBaseline] = useState<InterviewDraft | undefined>();
  const [turnDiffBaseline, setTurnDiffBaseline] = useState<InterviewDraft | undefined>();

  const isCurrentSession = (epoch: number) => epoch === sessionEpochRef.current;

  const invalidateSession = () => {
    sessionEpochRef.current += 1;
  };

  useEffect(() => {
    return window.ax.onAgentProgress((event) => setProgress(event.message));
  }, []);

  const reset = () => {
    invalidateSession();
    savedWorkflowIdRef.current = undefined;
    actionInFlightRef.current = false;
    setInterview(null);
    setSaved(false);
    setComposerText('');
    setBusy(false);
    setError('');
    setProgress('');
    setEditHint(null);
    setWorkflowBaseline(undefined);
    setTurnDiffBaseline(undefined);
  };

  const openWorkChat = async (workflowId: string) => {
    invalidateSession();
    const epoch = sessionEpochRef.current;
    setBusy(true);
    setError('');
    setComposerText('');
    setInterview(null);
    try {
      const loaded = await window.ax.loadWorkChat(workflowId);
      if (!isCurrentSession(epoch)) return;
      const state = await hydrateInterviewSummary({
        ...(loaded.state as InterviewState),
        summary: loaded.summary,
        title: loaded.title,
        workflowId,
      });
      if (!isCurrentSession(epoch)) return;
      setInterview({ ...state, title: interviewSessionTitle(state) });
      if (state.workflow) {
        const snapshot = cloneInterviewDraft(state.workflow);
        setWorkflowBaseline(snapshot);
        setTurnDiffBaseline(snapshot);
      }
      savedWorkflowIdRef.current = workflowId;
      setSaved(true);
    } catch (err) {
      if (!isCurrentSession(epoch)) return;
      setError(interviewErrorMessage(err));
    } finally {
      if (isCurrentSession(epoch)) setBusy(false);
    }
  };

  const startInterview = async () => {
    if (!composerText.trim() || busy) return;
    const text = composerText.trim();
    const epoch = sessionEpochRef.current;
    setBusy(true);
    setError('');
    setProgress('답변을 준비하고 있습니다');
    setSaved(false);
    savedWorkflowIdRef.current = undefined;
    actionInFlightRef.current = false;
    setWorkflowBaseline(emptyInterviewDraftBaseline());
    setTurnDiffBaseline(emptyInterviewDraftBaseline());
    setInterview({ messages: [{ role: 'user', content: text }], title: '새 업무' });
    try {
      const res = await window.ax.startInterview(text);
      if (!isCurrentSession(epoch)) return;
      const next = res as InterviewState;
      setInterview({ ...next, title: interviewSessionTitle(next) });
      setComposerText('');
    } catch (err) {
      if (!isCurrentSession(epoch)) return;
      setInterview(null);
      setError(interviewErrorMessage(err));
    } finally {
      if (isCurrentSession(epoch)) {
        setBusy(false);
        setProgress('');
      }
    }
  };

  const sendAnswer = async () => {
    if (!interview || !composerText.trim() || busy || actionInFlightRef.current) return;
    const content = composerText.trim();
    const prior = interview;
    const deployable = Boolean(prior.completeness?.deployable);
    const lastAssistant = [...(prior.messages ?? [])].reverse().find((message) => message.role === 'assistant');
    const wantsRun =
      deployable &&
      isAffirmativeRunIntent(content) &&
      (prior.done || (lastAssistant ? isRunConfirmationMessage(lastAssistant.content) : false));

    if (wantsRun && prior.draft && isImmediateOnce(prior.draft)) {
      setComposerText('');
      setEditHint(null);
      await runOnce();
      return;
    }

    const epoch = sessionEpochRef.current;
    setBusy(true);
    setError('');
    setProgress('답변을 준비하고 있습니다');
    setComposerText('');
    setEditHint(null);
    setTurnDiffBaseline(
      prior.workflow ? cloneInterviewDraft(prior.workflow as InterviewDraft) : emptyInterviewDraftBaseline(),
    );
    setInterview({
      ...prior,
      done: false,
      summary: undefined,
      messages: [...(prior.messages ?? []), { role: 'user', content }],
    });
    try {
      const res = await window.ax.applyAnswer(prior, content);
      if (!isCurrentSession(epoch)) return;
      const next = res as InterviewState & { draft?: unknown };
      if (next.done && next.draft) {
        const summary = await window.ax.summarize(next.draft);
        if (!isCurrentSession(epoch)) return;
        setInterview({ ...next, summary, title: interviewSessionTitle(next) });
      } else {
        setInterview({ ...next, title: interviewSessionTitle(next) });
      }
      if (next.workflowId) await refresh();
    } catch (err) {
      if (!isCurrentSession(epoch)) return;
      setError(interviewErrorMessage(err));
    } finally {
      if (isCurrentSession(epoch)) {
        setBusy(false);
        setProgress('');
      }
    }
  };

  const persistDraftWork = async (
    draft: unknown,
    prior: InterviewState,
    epoch: number,
  ): Promise<string | undefined> => {
    const existingId = prior.workflowId ?? savedWorkflowIdRef.current;
    if (existingId) return existingId;
    const savedWork = (await window.ax.saveWorkflow(draft)) as { workflowId: string };
    if (!isCurrentSession(epoch)) return undefined;
    savedWorkflowIdRef.current = savedWork.workflowId;
    return savedWork.workflowId;
  };

  const runOnce = async () => {
    if (!interview?.draft || busy || actionInFlightRef.current) return;
    const prior = interview;
    const epoch = sessionEpochRef.current;
    actionInFlightRef.current = true;
    setBusy(true);
    setError('');
    try {
      const workflowId = await persistDraftWork(prior.draft, prior, epoch);
      if (!workflowId || !isCurrentSession(epoch)) return;
      setInterview((current) =>
        current && isCurrentSession(epoch) ? { ...current, workflowId } : current,
      );
      const result = (await window.ax.runWorkflow(workflowId)) as {
        status?: string;
        errorCode?: string;
      };
      if (!isCurrentSession(epoch)) return;
      const trigger = draftTrigger(prior.draft);
      if (!trigger?.type || trigger.type === 'manual' || trigger.type === 'once') {
        await window.ax.setWorkflowActive(workflowId, false);
      }
      await refresh();
      if (!isCurrentSession(epoch)) return;
      if (result.status === 'failed' || result.status === 'cancelled') {
        const code = result.errorCode ?? result.status;
        setError(`실행에 실패했습니다 (${code}). 활동 탭에서 자세한 내용을 확인해 주세요.`);
        return;
      }
      setInterview((current) => {
        if (!current || !isCurrentSession(epoch)) return current;
        const next = appendAssistantMessage(
          { ...current, workflowId },
          result.status === 'pending_approval'
            ? '실행 중 승인이 필요합니다. 승인 탭에서 처리해 주세요.'
            : '실행을 시작했습니다. 활동 탭에서 진행 상황을 확인할 수 있어요.',
        );
        void window.ax.saveChatSession(next, next.summary, workflowId);
        return { ...next, title: interviewSessionTitle(next) };
      });
      setSaved(true);
    } catch (err) {
      if (!isCurrentSession(epoch)) return;
      setError(interviewErrorMessage(err));
    } finally {
      actionInFlightRef.current = false;
      if (isCurrentSession(epoch)) setBusy(false);
    }
  };

  const saveAsWork = async () => {
    if (!interview?.draft || interview.workflowId || busy || actionInFlightRef.current) return;
    const draft = interview.draft;
    const prior = interview;
    const epoch = sessionEpochRef.current;
    actionInFlightRef.current = true;
    setBusy(true);
    setError('');
    try {
      const workflowId = await persistDraftWork(draft, prior, epoch);
      if (!workflowId || !isCurrentSession(epoch)) return;
      const nextState: InterviewState = {
        ...prior,
        workflowId,
        title: interviewSessionTitle({ ...prior, workflowId }),
      };
      await window.ax.saveChatSession(nextState, nextState.summary, workflowId);
      if (!isCurrentSession(epoch)) return;
      setInterview(nextState);
      setSaved(true);
      if (nextState.workflow) {
        const snapshot = cloneInterviewDraft(nextState.workflow as InterviewDraft);
        setWorkflowBaseline(snapshot);
        setTurnDiffBaseline(snapshot);
      }
      await refresh();
      if (!isCurrentSession(epoch)) return;

      const trigger = draftTrigger(draft);
      if (shouldRunWorkflowAfterSave(trigger?.type)) {
        void window.ax.runWorkflow(workflowId);
      }
    } catch (err) {
      if (!isCurrentSession(epoch)) return;
      setError(interviewErrorMessage(err));
    } finally {
      actionInFlightRef.current = false;
      if (isCurrentSession(epoch)) setBusy(false);
    }
  };

  const beginEditStep = (prompt: string) => {
    setEditHint(prompt);
    setComposerText('');
  };

  return {
    composerText,
    interview,
    workflow: interview?.workflow as InterviewDraft | undefined,
    workflowBaseline,
    turnDiffBaseline,
    workflowDiffBaseline: (interview?.workflowId ? workflowBaseline : turnDiffBaseline) as
      | InterviewDraft
      | undefined,
    completeness: interview?.completeness as CompletenessResult | undefined,
    editHint,
    setEditHint,
    beginEditStep,
    saved,
    busy,
    error,
    progress,
    setComposerText,
    reset,
    openWorkChat,
    startInterview,
    sendAnswer,
    runOnce,
    saveAsWork,
    isLinkedWork: Boolean(interview?.workflowId),
    isImmediateOnce: interview?.draft ? isImmediateOnce(interview.draft) : false,
    isDeferredOnce: interview?.draft ? isDeferredOnce(interview.draft) : false,
    isRecurringDraft: interview?.draft ? isRecurringDraft(interview.draft) : false,
  };
}
