import type { InvestigationRunner } from '../agent/investigation-runner.js';
import type { WorkflowStore } from '../store/workflow-store.js';
import type { Connector } from '../modules/types.js';
import type { ArtifactSink, ExecutionLogEntry } from '../modules/types.js';
import type { ExecutionResultStatus } from '../contracts/execution-status.js';

export interface RuntimeConfig {
  store: WorkflowStore;
  investigationRunner?: InvestigationRunner;
  connectors?: Record<string, Connector>;
  artifactSink?: ArtifactSink;
  globalActive: boolean;
  workflowActive: Record<string, boolean>;
  onExecutionStarted?: (executionId: string) => void;
  onExecutionProgress?: (progress: ExecutionProgress) => void;
  onExecutionFinished?: (result: ExecutionResult) => void;
}

export type ExecutionProgressStatus =
  | 'step_started'
  | 'step_completed'
  | 'waiting_approval'
  | 'step_failed';

export interface ExecutionProgress {
  executionId: string;
  stepId: string;
  status: ExecutionProgressStatus;
  at: string;
  message: string;
}

export interface ExecutionResult {
  executionId: string;
  status: ExecutionResultStatus;
  errorCode?: string;
  log: ExecutionLogEntry[];
  pendingApprovalId?: string;
}

/** Inputs supplied by a trigger or the desktop manual-run boundary. */
export interface WorkflowExecutionOptions {
  ephemeral?: boolean;
  triggerType?: string;
  input?: Record<string, unknown>;
  /** Originating workspace chat for an ephemeral execution result projection. */
  workspaceSessionId?: string;
  /** Explicit manual run from UI — inactive ephemeral workflows may still run once. */
  forceManual?: boolean;
}

/** Host-owned handle returned before an ephemeral run starts. */
export interface EphemeralExecutionQueueItem {
  jobId: string;
}
