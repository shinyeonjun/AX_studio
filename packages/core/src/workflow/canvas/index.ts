/** Workflow canvas schema, validation, and presentation helpers. */

export { GMAIL_READ_WORKFLOW_NODE_ID } from './compile/constants.js';

export {
  WorkflowCanvasDraftSchema,
  WorkflowNodeSchema,
  parseBindingsRecord,
  parseJsonRecordValue,
  type ActionInstance,
  type WorkflowCanvasDraft,
  type WorkflowCanvasDraftInput,
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

export { explainExecution } from './revision/revision.js';
