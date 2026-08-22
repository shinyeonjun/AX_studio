/**
 * Interview module public API.
 *
 * Layout:
 * - session/     turn orchestration and persisted state
 * - draft/       workflow canvas schema and draft normalization
 * - compile/     InterviewDraft → WorkflowIR
 * - slots/       node-level requirement slots, patch merge
 * - agent/       typed authoring tools, draft patch contract, provider wire schema
 * - resources/   connected connector resources for prompts
 * - presentation/ summaries and documents
 * - revision/    execution explanation
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
export { isRunConfirmationMessage, shouldFinalizeInterview } from './session/messages.js';
export { applyAnswer, startInterview, type InterviewRunOptions } from './session/flow.js';
export { applyAgentDraftPatch } from './session/apply-agent-patch.js';

export { buildIRFromWorkflow, UnknownCapabilityError } from './compile/builder.js';
export { GMAIL_READ_WORKFLOW_NODE_ID } from './compile/constants.js';

export {
  InterviewDraftSchema,
  WorkflowNodeSchema,
  type ActionInstance,
  type InterviewDraft,
  type WorkflowNode,
} from './draft/schema.js';

export { applySlotValuesToDraft } from './slots/patch.js';
export {
  WorkflowDraftPatchSchema,
  parseWorkflowDraftPatch,
  type WorkflowDraftPatch,
} from './agent/draft-patch.js';
export {
  AGENTIC_INTERVIEW_MAX_ROUNDS,
  runAgenticInterviewLoop,
  type AgenticInterviewResult,
} from './agent/agent-loop.js';
export {
  AgenticInterviewWireEnvelopeSchema,
  agenticInterviewOutputSchemaForProvider,
  expandAgenticInterviewWireEnvelope,
  parseAgenticInterviewOutput,
} from './agent/agent-schema.js';

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

export { explainExecution } from './revision/revision.js';
