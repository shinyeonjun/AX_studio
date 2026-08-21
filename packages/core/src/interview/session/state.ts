import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { ChatMessage } from '../../agent/model/chat.js';
import type { WorkflowIR } from '../../workflow/schema.js';
import { KO } from '../../i18n/ko.js';
import { InterviewDraftSchema, type InterviewDraft } from '../draft/schema.js';
import type { WorkflowPlan } from '../plan/schema.js';
import { WorkflowPlanSchema } from '../plan/schema.js';
import { assessCompleteness, type CompletenessResult } from '../slots/requiredness.js';
import { resolveWorkScope, type WorkScope } from './work-scope.js';

export type InterviewSessionStatus = 'collecting' | 'planning' | 'ready' | 'done';
export type { WorkScope } from './work-scope.js';

export interface InterviewState {
  sessionId: string;
  userInstruction: string;
  /** User-selected scope at session start; drives trigger handling. */
  workScope?: WorkScope;
  /** Linked workflow after save; undefined while drafting. */
  workflowId?: string;
  /** Compiled IR used by runtime once the interview is done. */
  draft: Partial<WorkflowIR>;
  /** Code-owned canonical workflow canvas for UI and compile. */
  workflow: InterviewDraft;
  /** Accumulated slot values from patch turns. */
  slotValues: Record<string, unknown>;
  /** Latest structural plan from plan/replan turns. */
  partialPlan?: WorkflowPlan;
  status: InterviewSessionStatus;
  completeness: CompletenessResult;
  done: boolean;
  messages: ChatMessage[];
}

export type HydratedInterviewState = Omit<InterviewState, 'workScope'> & { workScope: WorkScope };

const PersistedInterviewStateSchema = z.object({
  sessionId: z.string().min(1),
  userInstruction: z.string(),
  workScope: z.enum(['once', 'recurring']).optional(),
  workflowId: z.string().min(1).optional(),
  draft: z.record(z.unknown()),
  workflow: InterviewDraftSchema,
  slotValues: z.record(z.unknown()),
  partialPlan: WorkflowPlanSchema.optional(),
  status: z.enum(['collecting', 'planning', 'ready', 'done']),
  completeness: z.object({
    slots: z.array(z.object({ slot: z.string(), filled: z.boolean(), label: z.string().optional(), question: z.string().optional() })),
    missingRequired: z.array(z.string()),
    deployable: z.boolean(),
    missingConnections: z.array(z.string()),
    contractIssues: z.array(z.record(z.unknown())).optional(),
  }),
  done: z.boolean(),
  messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string() })),
});

/** Validate data crossing the persisted-session or Electron IPC boundary. */
export function parseInterviewState(value: unknown): InterviewState {
  return PersistedInterviewStateSchema.parse(value) as InterviewState;
}

export function emptyInterviewDraft(instruction: string): InterviewDraft {
  return {
    name: KO.work.defaultName,
    goal: instruction,
    assumptions: [],
    nodes: [],
    actions: {},
  };
}

export function createInterviewState(instruction: string, workScope: WorkScope): InterviewState {
  const workflow = emptyInterviewDraft(instruction);
  const slotValues: Record<string, unknown> = {};
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
    workScope,
    draft,
    workflow,
    slotValues,
    status: 'collecting',
    completeness: assessCompleteness(draft),
    done: false,
    messages: [{ role: 'user', content: instruction }],
  };
}

function isPersistedAgentDiagnostic(message: ChatMessage): boolean {
  return (
    message.role === 'assistant' &&
    /^\[interview_(?:turn|discover_\d+)\]\s+provider=/.test(message.content.trim())
  );
}

/** Hydrate fields introduced by the current session model in older sessions. */
export function hydrateInterviewState(state: InterviewState): HydratedInterviewState {
  const workScope = resolveWorkScope(state);
  const workflowBase = {
    ...state.workflow,
    actions: state.workflow.actions ?? {},
  };
  const workflow = workflowBase;
  const slotValues = { ...(state.slotValues ?? {}) };
  return {
    ...state,
    messages: state.messages.filter((message) => !isPersistedAgentDiagnostic(message)),
    workScope,
    workflow,
    slotValues,
    status: state.status ?? (state.done ? 'done' : state.workflow.nodes.length > 0 ? 'planning' : 'collecting'),
  };
}
