import type { AgentHarness } from '../agent/harness.js';
import type { WorkflowStore } from '../store/workflow-store.js';
import type { Connector } from '../connectors/types.js';
import type { ExecutionLogEntry } from '../connectors/types.js';

export interface RuntimeConfig {
  store: WorkflowStore;
  agentHarness?: AgentHarness;
  connectors?: Record<string, Connector>;
  globalActive: boolean;
  workflowActive: Record<string, boolean>;
  onExecutionStarted?: (executionId: string) => void;
  onExecutionFinished?: (result: ExecutionResult) => void;
}

export interface ExecutionResult {
  executionId: string;
  status: 'success' | 'failed' | 'pending_approval' | 'cancelled';
  errorCode?: string;
  log: ExecutionLogEntry[];
  pendingApprovalId?: string;
}
