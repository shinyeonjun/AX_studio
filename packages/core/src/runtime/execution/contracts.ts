import type { Connector } from '../../connectors/types.js';
import type { ExecutionProgress, ExecutionResult, RuntimeConfig } from '../types.js';
import type { Step, WorkflowIR } from '../../workflow/schema.js';
import type { ApprovalStorePort } from './approval/store-port.js';

export interface WorkflowExecutionHost {
  readonly toolResults?: import('../tool-result-approval.js').ToolResultApprovals;
  readonly config: RuntimeConfig;
  /** The approval flow's storage view; config.store stays for the rest of the run. */
  readonly approvals: ApprovalStorePort;
  readonly connectors: Record<string, Connector>;
  notifyExecutionStarted(executionId: string): void;
  notifyExecutionProgress(progress: ExecutionProgress): void;
  notifyExecutionFinished(result: ExecutionResult): boolean | void;
}

export type PendingError = Error & {
  code?: string;
  approvalId?: string;
  pending?: boolean;
  checkpoint?: import('../control-flow.js').ExecutionCheckpoint;
};

export function isExternalAction(step: Step, ir: WorkflowIR): boolean {
  return step.type === 'action' &&
    (ir.sideEffects?.[step.id] ?? step.sideEffect) in {
      EXTERNAL: true,
      EXTERNAL_HIGH: true,
    };
}
