import { randomUUID } from 'node:crypto';
import type { ChatMessage } from '../agent/model/chat.js';
import type { WorkflowIR } from '../workflow/schema.js';
import { assessCompleteness, type CompletenessResult } from './requiredness.js';
import type { InterviewDraft } from './workflow-schema.js';
import { KO } from '../i18n/ko.js';

export interface InterviewState {
  sessionId: string;
  userInstruction: string;
  /** Linked workflow after save; undefined while drafting. */
  workflowId?: string;
  /** Compiled IR used by runtime once the interview is done. */
  draft: Partial<WorkflowIR>;
  /** AI-owned workflow canvas, sent back to the model every turn. */
  workflow: InterviewDraft;
  completeness: CompletenessResult;
  done: boolean;
  messages: ChatMessage[];
}

export function emptyInterviewDraft(instruction: string): InterviewDraft {
  return {
    name: KO.work.defaultName,
    goal: instruction,
    triggerType: 'manual',
    assumptions: [],
    nodes: [],
  };
}

export function createInterviewState(instruction: string): InterviewState {
  const workflow = emptyInterviewDraft(instruction);
  const draft: Partial<WorkflowIR> = {
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
