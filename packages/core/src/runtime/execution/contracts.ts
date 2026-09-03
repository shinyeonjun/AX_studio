import type { Connector } from '../../modules/types.js';
import type { ExecutionProgress, ExecutionResult, RuntimeConfig } from '../types.js';
import type { Step, WorkflowIR } from '../../workflow/schema.js';

export interface WorkflowExecutionHost {
  readonly config: RuntimeConfig;
  readonly connectors: Record<string, Connector>;
  notifyExecutionStarted(executionId: string): void;
  notifyExecutionProgress(progress: ExecutionProgress): void;
  notifyExecutionFinished(result: ExecutionResult): void;
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
