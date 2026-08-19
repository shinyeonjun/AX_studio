import { useEffect, useRef, useState } from 'react';
import { shouldRunSkillAfterSave } from '../lib/skill-display';

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
  return state.skillId ? '업무' : '새 업무';
}

export function useInterview({ refresh, onWorkSaved }: UseInterviewOptions) {
  const sessionEpochRef = useRef(0);
  const [composerText, setComposerText] = useState('');
  const [interview, setInterview] = useState<InterviewState | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState('');

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
  };

  const openSkillChat = async (skillId: string) => {
    invalidateSession();
    const epoch = sessionEpochRef.current;
    setBusy(true);
    setError('');
    setComposerText('');
    setInterview(null);
    try {
      const loaded = await window.ax.loadSkillChat(skillId);
      if (!isCurrentSession(epoch)) return;
      const state = await hydrateSummary({
        ...(loaded.state as InterviewState),
        summary: loaded.summary,
        title: loaded.title,
        skillId,
      });
      if (!isCurrentSession(epoch)) return;
      setInterview({ ...state, title: sessionTitle(state) });
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
      if (next.skillId) await refresh();
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
        void window.ax.saveChatSession(next, next.summary, next.skillId);
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
    if (!interview?.draft || interview.skillId) return;
    const draft = interview.draft;
    const epoch = sessionEpochRef.current;
    setBusy(true);
    setError('');
    try {
      const savedSkill = (await window.ax.saveSkill(draft)) as { skillId: string };
      if (!isCurrentSession(epoch)) return;
      setSaved(true);
      await refresh();
      if (!isCurrentSession(epoch)) return;
      onWorkSaved?.();
      reset();

      const trigger = draftTrigger(draft);
      if (shouldRunSkillAfterSave(trigger?.type)) {
        void window.ax.runSkill(savedSkill.skillId);
      }
    } catch (err) {
      if (!isCurrentSession(epoch)) return;
      setError(errorMessage(err));
    } finally {
      if (isCurrentSession(epoch)) setBusy(false);
    }
  };

  return {
    composerText,
    interview,
    saved,
    busy,
    error,
    progress,
    setComposerText,
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
