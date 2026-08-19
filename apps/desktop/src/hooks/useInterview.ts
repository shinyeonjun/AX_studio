import { useState } from 'react';
import type { Tab } from '../types/navigation';

interface InterviewMessage {
  role: string;
  content: string;
}

export interface InterviewState {
  done?: boolean;
  draft?: unknown;
  summary?: string;
  messages?: InterviewMessage[];
  completeness?: { slots?: Array<{ slot: string; filled: boolean }> };
}

export function useInterview(
  refresh: () => Promise<void>,
  setTab: (tab: Tab) => void,
) {
  const [instruction, setInstruction] = useState('');
  const [answer, setAnswer] = useState('');
  const [interview, setInterview] = useState<InterviewState | null>(null);
  const [saved, setSaved] = useState(false);

  const reset = () => {
    setInterview(null);
    setSaved(false);
    setInstruction('');
    setAnswer('');
  };

  const startInterview = async () => {
    if (!instruction.trim()) return;
    const res = await window.ax.startInterview(instruction);
    setInterview(res as InterviewState);
    setSaved(false);
  };

  const sendAnswer = async () => {
    if (!interview || !answer.trim()) return;
    const res = await window.ax.applyAnswer(interview, answer);
    const next = res as InterviewState & { draft?: unknown };
    if (next.done && next.draft) {
      const summary = await window.ax.summarize(next.draft);
      setInterview({ ...next, summary });
    } else {
      setInterview(next);
    }
    setAnswer('');
  };

  const saveAndRun = async () => {
    if (!interview?.draft) return;
    const savedSkill = await window.ax.saveSkill(interview.draft) as { skillId: string };
    await window.ax.runSkill(savedSkill.skillId);
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
    setInstruction,
    setAnswer,
    reset,
    startInterview,
    sendAnswer,
    saveAndRun,
    testRun,
  };
}
