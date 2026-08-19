import { randomUUID } from 'node:crypto';
import type { ChatMessage } from '../agents-harness/model/chat.js';
import type { SkillIR } from '../skill/schema.js';
import { assessCompleteness, type CompletenessResult } from './requiredness.js';
import type { InterviewDraft } from './workflow-schema.js';

export interface InterviewState {
  sessionId: string;
  userInstruction: string;
  /** Compiled IR used by runtime once the interview is done. */
  draft: Partial<SkillIR>;
  /** AI-owned workflow canvas, sent back to the model every turn. */
  workflow: InterviewDraft;
  completeness: CompletenessResult;
  done: boolean;
  messages: ChatMessage[];
}

export function emptyInterviewDraft(instruction: string): InterviewDraft {
  return {
    name: '새 업무',
    goal: instruction,
    triggerType: 'manual',
    assumptions: [],
    nodes: [],
  };
}

export function createInterviewState(instruction: string): InterviewState {
  const workflow = emptyInterviewDraft(instruction);
  const draft: Partial<SkillIR> = {
    name: workflow.name,
    goal: instruction,
    steps: [],
    assumptions: [],
    permissions: {},
    approval: [],
    allowExternalAuto: true,
    dataPolicy: { emailBody: { cloudAllowed: false } },
  };
  return {
    sessionId: randomUUID(),
    userInstruction: instruction,
    draft,
    workflow,
    completeness: assessCompleteness(draft),
    done: false,
    messages: [{ role: 'user', content: instruction }],
  };
}
