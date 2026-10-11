import type { WorkflowStore } from '../../../persistence/workflow-store.js';

/**
 * What the approval flow may ask of storage: approval rows and the execution rows they
 * resume. Workflow definitions, triggers and chat stay out of its reach, so an approval
 * cannot change them by accident. WorkflowStore satisfies this structurally.
 */
export type ApprovalStorePort = Pick<WorkflowStore,
  | 'getApproval'
  | 'getPendingApprovals'
  | 'getProcessingApprovals'
  | 'getApprovalRecoveryCandidates'
  | 'claimApproval'
  | 'failApproval'
  | 'resolveApproval'
  | 'rejectPendingApproval'
  | 'updateApprovalPayload'
  | 'getExecution'
  | 'finishExecution'
  | 'markExecutionPending'
  | 'updateExecutionLog'
  | 'appendExecutionLog'
  | 'getConnections'
  // Tool-result review shows approvals in chat, so the approval flow reads these too.
  | 'hasWorkspaceChat'
  | 'getConnectionRevision'
  | 'chatHostState'
  | 'onWorkspaceChatDeleted'
>;
