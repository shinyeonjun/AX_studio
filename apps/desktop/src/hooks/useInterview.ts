import { useEffect, useState } from 'react';

interface InterviewMessage {
  role: string;
  content: string;
}

type DraftTrigger = { type?: string; runAt?: string };

export interface InterviewState {
  sessionId?: string;
  skillId?: string;
  done?: boolean;
  draft?: unknown;
  summary?: string;
  title?: string;
  messages?: InterviewMessage[];
  completeness?: { slots?: Array<{ slot: string; filled: boolean; label?: string }> };
}

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
  return type === 'schedule' || type === 'gmail.new_message';
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
  return state.skillId ? '업무' : '새 업무';
}

export function useInterview({ refresh, onWorkSaved }: UseInterviewOptions) {
  const [instruction, setInstruction] = useState('');
  const [answer, setAnswer] = useState('');
  const [interview, setInterview] = useState<InterviewState | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState('');

  useEffect(() => {
    return window.ax.onAgentProgress((event) => setProgress(event.message));
  }, []);

  const reset = () => {
    setInterview(null);
    setSaved(false);
    setInstruction('');
    setAnswer('');
    setBusy(false);
    setError('');
    setProgress('');
  };

  const openSkillChat = async (skillId: string) => {
    setBusy(true);
    setError('');
    try {
      const loaded = await window.ax.loadSkillChat(skillId);
      const state = await hydrateSummary({
        ...(loaded.state as InterviewState),
        summary: loaded.summary,
        title: loaded.title,
        skillId,
      });
      setInterview({ ...state, title: sessionTitle(state) });
      setSaved(true);
      setInstruction('');
      setAnswer('');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const startInterview = async () => {
    if (!instruction.trim() || busy) return;
    setBusy(true);
    setError('');
    setProgress('답변을 준비하고 있습니다');
    setSaved(false);
    setInterview({ messages: [{ role: 'user', content: instruction }], title: '새 업무' });
    try {
      const res = await window.ax.startInterview(instruction);
      const next = res as InterviewState;
      setInterview({ ...next, title: sessionTitle(next) });
      setInstruction('');
    } catch (err) {
      setInterview(null);
      setError(errorMessage(err));
    } finally {
      setBusy(false);
      setProgress('');
    }
  };

  const sendAnswer = async () => {
    if (!interview || !answer.trim() || busy) return;
    const content = answer.trim();
    const prior = interview;
    setBusy(true);
    setError('');
    setProgress('답변을 준비하고 있습니다');
    setAnswer('');
    setInterview({
      ...prior,
      done: false,
      summary: undefined,
      messages: [...(prior.messages ?? []), { role: 'user', content }],
    });
    try {
      const res = await window.ax.applyAnswer(prior, content);
      const next = res as InterviewState & { draft?: unknown };
      if (next.done && next.draft) {
        const summary = await window.ax.summarize(next.draft);
        setInterview({ ...next, summary, title: sessionTitle(next) });
      } else {
        setInterview({ ...next, title: sessionTitle(next) });
      }
      if (next.skillId) await refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
      setProgress('');
    }
  };

  const runOnce = async () => {
    if (!interview?.draft) return;
    setBusy(true);
    setError('');
    try {
      await window.ax.runEphemeral(interview.draft);
      await refresh();
      setInterview((current) => {
        if (!current) return current;
        const next = appendAssistantMessage(
          current,
          '실행을 시작했습니다. 승인이 필요하면 승인 탭에서 처리할 수 있어요.',
        );
        void window.ax.saveChatSession(next, next.summary, next.skillId);
        return next;
      });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const saveAsWork = async () => {
    if (!interview?.draft || interview.skillId) return;
    setBusy(true);
    setError('');
    try {
      const savedSkill = await window.ax.saveSkill(interview.draft) as { skillId: string };
      const trigger = draftTrigger(interview.draft);
      const deferredOnce =
        trigger?.type === 'once' && trigger.runAt && Date.parse(trigger.runAt) > Date.now() + 10_000;
      if (!deferredOnce && trigger?.type !== 'once') {
        await window.ax.runSkill(savedSkill.skillId);
      }
      setSaved(true);
      await refresh();
      onWorkSaved?.();
      reset();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return {
    instruction,
    answer,
    interview,
    saved,
    busy,
    error,
    progress,
    setInstruction,
    setAnswer,
    reset,
    openSkillChat,
    startInterview,
    sendAnswer,
    runOnce,
    saveAsWork,
    isLinkedSkill: Boolean(interview?.skillId),
    isImmediateOnce: interview?.draft ? isImmediateOnce(interview.draft) : false,
    isDeferredOnce: interview?.draft ? isDeferredOnce(interview.draft) : false,
    isRecurringDraft: interview?.draft ? isRecurringDraft(interview.draft) : false,
  };
}
