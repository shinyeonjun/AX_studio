import { useEffect, useRef, useState } from 'react';
import type { InterviewState as CoreInterviewState } from '@ax-studio/core/interview-state';
import type { InterviewDraft } from '@ax-studio/core/workflow-schema';
import type { CompletenessResult } from '@ax-studio/core/requiredness';
import { shouldRunWorkflowAfterSave } from '../lib/work-display';

interface InterviewMessage {
  role: string;
  content: string;
}

type DraftTrigger = { type?: string; runAt?: string };

export type InterviewState = Partial<CoreInterviewState> & {
  title?: string;
  summary?: string;
  messages?: InterviewMessage[];
};

export interface UseInterviewOptions {
  refresh: () => Promise<void>;
  onWorkSaved?: () => void;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '인터뷰 처리에 실패했습니다.';
}

function draftTrigger(draft: unknown): DraftTrigger | undefined {
  return (draft as { trigger?: DraftTrigger } | undefined)?.trigger;
}

export function isDeferredOnce(draft: unknown): boolean {
  const trigger = draftTrigger(draft);
  if (trigger?.type !== 'once' || !trigger.runAt) return false;
  return Date.parse(trigger.runAt) > Date.now() + 10_000;
}

export function isImmediateOnce(draft: unknown): boolean {
  const trigger = draftTrigger(draft);
  if (trigger?.type === 'manual') return true;
  if (trigger?.type !== 'once') return false;
  if (!trigger.runAt) return true;
  return Date.parse(trigger.runAt) <= Date.now() + 10_000;
}

export function isRecurringDraft(draft: unknown): boolean {
  const type = draftTrigger(draft)?.type;
  return type === 'schedule' || type === 'gmail.new_message' || type === 'slack.new_message';
}

function appendAssistantMessage(state: InterviewState, content: string): InterviewState {
  return {
    ...state,
    done: false,
    summary: undefined,
    messages: [...(state.messages ?? []), { role: 'assistant', content }],
  };
}

async function hydrateSummary(state: InterviewState): Promise<InterviewState> {
  if (state.summary) return state;
  if (state.done && state.draft) {
    const summary = await window.ax.summarize(state.draft);
    return { ...state, summary };
  }
  return state;
}

function sessionTitle(state: InterviewState): string {
  if (state.title?.trim()) return state.title.trim();
  const draftName = (state.draft as { name?: string } | undefined)?.name;
  if (draftName?.trim()) return draftName.trim();
  return state.workflowId ? '업무' : '새 업무';
}

export function useInterview({ refresh, onWorkSaved }: UseInterviewOptions) {
  const sessionEpochRef = useRef(0);
  const [composerText, setComposerText] = useState('');
  const [interview, setInterview] = useState<InterviewState | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState('');
  const [editHint, setEditHint] = useState<string | null>(null);
  const [workflowBaseline, setWorkflowBaseline] = useState<InterviewDraft | undefined>();
  const [turnDiffBaseline, setTurnDiffBaseline] = useState<InterviewDraft | undefined>();

  function cloneWorkflow(draft: InterviewDraft): InterviewDraft {
    return JSON.parse(JSON.stringify(draft)) as InterviewDraft;
  }

  const emptyWorkflowBaseline = (): InterviewDraft => ({
    name: '',
    goal: '',
    triggerType: 'manual',
    assumptions: [],
    nodes: [],
  });

  const isCurrentSession = (epoch: number) => epoch === sessionEpochRef.current;

  const invalidateSession = () => {
    sessionEpochRef.current += 1;
  };

  useEffect(() => {
    return window.ax.onAgentProgress((event) => setProgress(event.message));
  }, []);

  const reset = () => {
    invalidateSession();
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
      const state = await hydrateSummary({
        ...(loaded.state as InterviewState),
        summary: loaded.summary,
        title: loaded.title,
        workflowId,
      });
      if (!isCurrentSession(epoch)) return;
      setInterview({ ...state, title: sessionTitle(state) });
      if (state.workflow) {
        const snapshot = cloneWorkflow(state.workflow);
        setWorkflowBaseline(snapshot);
        setTurnDiffBaseline(snapshot);
      }
      setSaved(true);
    } catch (err) {
      if (!isCurrentSession(epoch)) return;
      setError(errorMessage(err));
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
    setWorkflowBaseline(emptyWorkflowBaseline());
    setTurnDiffBaseline(emptyWorkflowBaseline());
    setInterview({ messages: [{ role: 'user', content: text }], title: '새 업무' });
    try {
      const res = await window.ax.startInterview(text);
      if (!isCurrentSession(epoch)) return;
      const next = res as InterviewState;
      setInterview({ ...next, title: sessionTitle(next) });
      setComposerText('');
    } catch (err) {
      if (!isCurrentSession(epoch)) return;
      setInterview(null);
      setError(errorMessage(err));
    } finally {
      if (isCurrentSession(epoch)) {
        setBusy(false);
        setProgress('');
      }
    }
  };

  const sendAnswer = async () => {
    if (!interview || !composerText.trim() || busy) return;
    const content = composerText.trim();
    const prior = interview;
    const epoch = sessionEpochRef.current;
    setBusy(true);
    setError('');
    setProgress('답변을 준비하고 있습니다');
    setComposerText('');
    setEditHint(null);
    setTurnDiffBaseline(prior.workflow ? cloneWorkflow(prior.workflow as InterviewDraft) : emptyWorkflowBaseline());
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
        setInterview({ ...next, summary, title: sessionTitle(next) });
      } else {
        setInterview({ ...next, title: sessionTitle(next) });
      }
      if (next.workflowId) await refresh();
    } catch (err) {
      if (!isCurrentSession(epoch)) return;
      setError(errorMessage(err));
    } finally {
      if (isCurrentSession(epoch)) {
        setBusy(false);
        setProgress('');
      }
    }
  };

  const runOnce = async () => {
    if (!interview?.draft) return;
    const epoch = sessionEpochRef.current;
    setBusy(true);
    setError('');
    try {
      await window.ax.runEphemeral(interview.draft);
      if (!isCurrentSession(epoch)) return;
      await refresh();
      if (!isCurrentSession(epoch)) return;
      setInterview((current) => {
        if (!current || !isCurrentSession(epoch)) return current;
        const next = appendAssistantMessage(
          current,
          '실행을 시작했습니다. 승인이 필요하면 승인 탭에서 처리할 수 있어요.',
        );
        void window.ax.saveChatSession(next, next.summary, next.workflowId);
        return next;
      });
    } catch (err) {
      if (!isCurrentSession(epoch)) return;
      setError(errorMessage(err));
    } finally {
      if (isCurrentSession(epoch)) setBusy(false);
    }
  };

  const saveAsWork = async () => {
    if (!interview?.draft || interview.workflowId) return;
    const draft = interview.draft;
    const epoch = sessionEpochRef.current;
    setBusy(true);
    setError('');
    try {
      const savedWork = (await window.ax.saveWorkflow(draft)) as { workflowId: string };
      if (!isCurrentSession(epoch)) return;
      setSaved(true);
      await refresh();
      if (!isCurrentSession(epoch)) return;
      onWorkSaved?.();
      reset();

      const trigger = draftTrigger(draft);
      if (shouldRunWorkflowAfterSave(trigger?.type)) {
        void window.ax.runWorkflow(savedWork.workflowId);
      }
    } catch (err) {
      if (!isCurrentSession(epoch)) return;
      setError(errorMessage(err));
    } finally {
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
