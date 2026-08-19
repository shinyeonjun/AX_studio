import { useEffect, useState } from 'react';
import type { Tab } from '../types/navigation';

interface InterviewMessage {
  role: string;
  content: string;
}

export interface InterviewState {
  sessionId?: string;
  done?: boolean;
  draft?: unknown;
  summary?: string;
  messages?: InterviewMessage[];
  completeness?: { slots?: Array<{ slot: string; filled: boolean; label?: string }> };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '인터뷰 처리에 실패했습니다.';
}

export function useInterview(
  refresh: () => Promise<void>,
  setTab: (tab: Tab) => void,
) {
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

  const startInterview = async () => {
    if (!instruction.trim() || busy) return;
    setBusy(true);
    setError('');
    setProgress('답변을 준비하고 있습니다');
    setSaved(false);
    setInterview({ messages: [{ role: 'user', content: instruction }] });
    try {
      const res = await window.ax.startInterview(instruction);
      setInterview(res as InterviewState);
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
    setBusy(true);
    setError('');
    setProgress('답변을 준비하고 있습니다');
    setAnswer('');
    setInterview({
      ...interview,
      messages: [...(interview.messages ?? []), { role: 'user', content }],
    });
    try {
      const res = await window.ax.applyAnswer(interview, content);
      const next = res as InterviewState & { draft?: unknown };
      if (next.done && next.draft) {
        const summary = await window.ax.summarize(next.draft);
        setInterview({ ...next, summary });
      } else {
        setInterview(next);
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
      setProgress('');
    }
  };

  const saveAndRun = async () => {
    if (!interview?.draft) return;
    const savedSkill = await window.ax.saveSkill(interview.draft) as { skillId: string };
    const trigger = (interview.draft as { trigger?: { type?: string; runAt?: string } }).trigger;
    const deferredOnce =
      trigger?.type === 'once' && trigger.runAt && Date.parse(trigger.runAt) > Date.now() + 10_000;
    if (!deferredOnce) {
      await window.ax.runSkill(savedSkill.skillId);
    }
    setSaved(true);
    await refresh();
    setTab('work');
  };

  const testRun = async () => {
    if (!interview?.draft) return;
    await window.ax.runEphemeral(interview.draft);
    await refresh();
    setTab('activity');
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
    startInterview,
    sendAnswer,
    saveAndRun,
    testRun,
  };
}
