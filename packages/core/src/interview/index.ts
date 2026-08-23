/** Workflow canvas schema, compiler, validation, and presentation helpers. */

export { buildIRFromWorkflow, UnknownCapabilityError } from './compile/builder.js';
export { GMAIL_READ_WORKFLOW_NODE_ID } from './compile/constants.js';

export {
  InterviewDraftSchema,
  WorkflowNodeSchema,
  type ActionInstance,
  type InterviewDraft,
  type WorkflowNode,
} from './draft/schema.js';

export {
  assessCompleteness,
  computeRequiredSlots,
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

export { explainExecution } from './revision/revision.js';
