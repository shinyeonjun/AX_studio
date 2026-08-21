/**
 * Interview module public API.
 *
 * Layout:
 * - session/     turn orchestration and persisted state
 * - draft/       workflow canvas schema and draft normalization
 * - compile/     InterviewDraft → WorkflowIR
 * - slots/       node-level requirement slots, patch merge
 * - plan/        AI structural plan schema
 * - agent/       provider output contract and discovery loop
 * - resources/   connected connector resources for prompts
 * - presentation/ summaries and documents
 * - revision/    post-save workflow revision
 * - bootstrap/   resume interview from saved workflow
 */

export type { InterviewState, InterviewSessionStatus, WorkScope } from './session/state.js';
export {
  createInterviewState,
  emptyInterviewDraft,
  hydrateInterviewState,
  parseInterviewState,
} from './session/state.js';
export { isRecurringTriggerType, resolveWorkScope } from './session/work-scope.js';
export { isRunConfirmationMessage } from './session/messages.js';
export { applyAnswer, startInterview, type InterviewRunOptions } from './session/flow.js';
export { applyInterviewPatch, type InterviewPatchOptions } from './session/patch-turn.js';

export { buildIRFromWorkflow, UnknownCapabilityError } from './compile/builder.js';
export { GMAIL_READ_WORKFLOW_NODE_ID } from './compile/constants.js';

export {
  InterviewDraftSchema,
  InterviewTurnSchema,
  WorkflowNodeSchema,
  type ActionInstance,
  type InterviewDraft,
  type InterviewTurn,
  type WorkflowNode,
} from './draft/schema.js';

export { InterviewPatchSchema, mergePatch, applySlotValuesToDraft, type InterviewPatch } from './slots/patch.js';
export { WorkflowPlanSchema, planToInterviewDraft, type WorkflowPlan } from './plan/schema.js';

export {
  InterviewWireEnvelopeSchema,
  interviewOutputSchemaForProvider,
  expandInterviewWireEnvelope,
} from './agent/wire-schema.js';

export {
  assessCompleteness,
  computeRequiredSlots,
  formatMissingSlotsForPrompt,
  getNextQuestion,
  type CompletenessResult,
  type RequirementSlot,
  type SlotState,
} from './slots/requiredness.js';

export { summarizeWorkflow, renderChatSummary } from './presentation/chat-summary.js';
export {
  connectionGuidance,
  isTriggerRequirementSlot,
  panelFieldsForSource,
  type PanelField,
} from './presentation/panel-fields.js';
export { renderWorkflowDocument } from './presentation/workflow-document.js';

export { bootstrapInterviewFromWorkflow } from './bootstrap/from-workflow.js';
export {
  buildConnectedResourcesFromConnections,
  buildLocalFolderResources,
  formatConnectedResourcesForPrompt,
  type ConnectedResourcesSnapshot,
  type ListedFileRef,
} from './resources/connected-resources.js';

export { explainExecution, proposeWorkflowRevision, type WorkflowRevisionOptions } from './revision/revision.js';
export { WorkflowRevisionSchema } from './revision/schema.js';
