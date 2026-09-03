import type { WorkflowStore } from '../../../store/workflow-store.js';
import type { ExecutionResult } from '../../types.js';
import type { WorkflowExecutionHost } from '../contracts.js';

type Approval = NonNullable<ReturnType<WorkflowStore['getApproval']>>;
type Execution = NonNullable<ReturnType<WorkflowStore['getExecution']>>;

export type ApprovalResumeGuard =
  | { ok: true; approval: Approval; execution: Execution }
  | { ok: false; result: ExecutionResult };

export function prepareApprovalResume(
  host: WorkflowExecutionHost,
  approvalId: string,
): ApprovalResumeGuard {
  const approval = host.config.store.getApproval(approvalId);
  if (!approval) {
    return {
      ok: false,
      result: { executionId: '', status: 'failed', errorCode: 'approval_not_found', log: [] },
    };
  }
  if (approval.status !== 'pending') {
    return {
      ok: false,
      result: {
        executionId: approval.executionId,
        status: 'failed',
        errorCode: approval.status === 'processing' ? 'approval_in_progress' : 'approval_already_resolved',
        log: [],
      },
    };
  }
  // Approval is an external side-effect boundary. Turning the global
  // execution switch off must also block a later approval resume; leave the
  // approval pending so it can be retried after the user turns execution on.
  if (!host.config.globalActive) {
    return {
      ok: false,
      result: {
        executionId: approval.executionId,
        status: 'cancelled',
        errorCode: 'global_off_duty',
        log: [],
      },
    };
  }
  if (!host.config.store.claimApproval(approvalId)) {
    return {
      ok: false,
      result: { executionId: approval.executionId, status: 'failed', errorCode: 'approval_in_progress', log: [] },
    };
  }

  const execution = host.config.store.getExecution(approval.executionId);
  if (!execution) {
    host.config.store.failApproval(approvalId);
    return {
      ok: false,
      result: { executionId: approval.executionId, status: 'failed', errorCode: 'execution_not_found', log: [] },
    };
  }

  return { ok: true, approval, execution };
}
