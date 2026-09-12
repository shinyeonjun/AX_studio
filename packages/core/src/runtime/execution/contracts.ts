import type { Connector } from '../../connectors/types.js';
import type { ExecutionProgress, ExecutionResult, RuntimeConfig } from '../types.js';

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
