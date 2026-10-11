import type { WorkflowStore } from '../../persistence/workflow-store.js';

/**
 * What the trigger engine may ask of storage: saved workflows and their activation, trigger
 * receipts, cursors and settings. Approvals, discovery and chat stay out of its reach, so the
 * trigger context cannot change them by accident. WorkflowStore satisfies this structurally.
 */
export type TriggerEngineStore = Pick<WorkflowStore,
  | 'saveWorkflow'
  | 'getWorkflow'
  | 'deleteWorkflow'
  | 'setWorkflowActive'
  | 'listActiveWorkflowDefinitions'
  | 'getGlobalActive'
  | 'listExecutions'
  | 'getSetting'
  | 'setSetting'
  | 'deleteSetting'
  | 'setConnection'
  | 'getConnections'
  | 'claimTriggerReceipt'
  | 'completeTriggerReceipt'
  | 'failTriggerReceipt'
  | 'deadLetterTriggerReceipt'
  | 'isTriggerReceiptCompleted'
>;
