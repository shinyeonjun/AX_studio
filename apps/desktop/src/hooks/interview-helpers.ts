import type { InterviewState as CoreInterviewState } from '@ax-studio/core/interview-state';
import type { InterviewDraft } from '@ax-studio/core/workflow-schema';
import { isRecurringTriggerType } from '../lib/work-display';

type DraftTrigger = { type?: string; runAt?: string };

export type InterviewState = Partial<CoreInterviewState> & {
  title?: string;
  summary?: string;
  messages?: Array<{ role: string; content: string }>;
};

export function interviewErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '인터뷰 처리에 실패했습니다.';
}

export function draftTrigger(draft: unknown): DraftTrigger | undefined {
  return (draft as { trigger?: DraftTrigger } | undefined)?.trigger;
}

export function draftTriggerType(draft: unknown): string | undefined {
  const fromIr = draftTrigger(draft)?.type;
  if (fromIr) return fromIr;
  return (draft as { triggerType?: string } | undefined)?.triggerType;
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
  return isRecurringTriggerType(draftTriggerType(draft));
}

export function appendAssistantMessage(state: InterviewState, content: string): InterviewState {
  return {
    ...state,
    done: false,
    summary: undefined,
    messages: [...(state.messages ?? []), { role: 'assistant', content }],
  };
}

export async function hydrateInterviewSummary(state: InterviewState): Promise<InterviewState> {
  if (state.summary) return state;
  if (state.done && state.draft) {
    const summary = await window.ax.summarize(state.draft);
    return { ...state, summary };
  }
  return state;
}

export function interviewSessionTitle(state: InterviewState): string {
  if (state.title?.trim()) return state.title.trim();
  const draftName = (state.draft as { name?: string } | undefined)?.name;
  if (draftName?.trim()) return draftName.trim();
  return state.workflowId ? '업무' : '새 업무';
}

export function cloneInterviewDraft(draft: InterviewDraft): InterviewDraft {
  return JSON.parse(JSON.stringify(draft)) as InterviewDraft;
}

export function emptyInterviewDraftBaseline(): InterviewDraft {
  return {
    name: '',
    goal: '',
    triggerType: 'manual',
    assumptions: [],
    nodes: [],
  };
}
