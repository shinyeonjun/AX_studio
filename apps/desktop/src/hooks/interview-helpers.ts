import type { InterviewDraft, InterviewState as CoreInterviewState } from '@ax-studio/core';
import { isRecurringTriggerType } from '@ax-studio/core/work-scope';

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

export function isAffirmativeRunIntent(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return false;
  return /^(y|yes|ok|okay|go|ㅇㅇ|응|네|맞아|좋아|실행|해줘|ㄱ|그래|맞습니다)[.!?]*$/u.test(normalized);
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
    assumptions: [],
    nodes: [],
    actions: {},
  };
}
