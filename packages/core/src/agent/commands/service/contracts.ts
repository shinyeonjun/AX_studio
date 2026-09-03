import type { ArtifactStore } from '../../../store/artifact-store.js';
import type { WorkflowStore } from '../../../store/workflow-store.js';
import type { WorkspaceSourceService } from '../../../store/workspace-source-service.js';
import type { WorkflowIR } from '../../../workflow/schema.js';
import type { AxCommandExecutionContext } from '../access.js';
import type { AxCommandReadContext, AxCommandReadGateway } from '../read-gateway.js';
import type { DiscoveryCommandGateway } from '../discovery-gateway.js';
import type { PendingJobDraft } from '../job-registration/contract.js';
import type { RepairCommandGateway } from '../repair-gateway.js';
import type { AxWorkflowCommandGateway } from '../workflow-gateway/contract.js';

export interface AxCommandServiceOptions {
  runWorkflow?: (workflowId: string) => Promise<unknown>;
  enqueueOnce?: (
    workflow: WorkflowIR,
    options?: { workspaceSessionId?: string },
  ) => Promise<unknown> | unknown;
  readGateway?: AxCommandReadGateway;
  artifactStore?: ArtifactStore;
  workspaceSources?: WorkspaceSourceService;
  resolveConnectionConfig?: (connector: string, config: unknown) => Promise<unknown> | unknown;
  autoResumeDiscovery?: boolean;
  repairSnapshotRoot?: string;
}

export interface AxCommandExecuteOptions {
  designToolContext?: AxCommandReadContext;
  designToolContextFactory?: () => AxCommandReadContext;
  executionContext?: AxCommandExecutionContext;
  workspaceSessionId?: string;
  currentWorkflowId?: string;
  /** Only a host-rendered confirm_context action may enable this mutation. */
  allowContextUpdate?: boolean;
  /** Only a host-rendered confirm_job action may enable this mutation. */
  allowJobCommit?: boolean;
}

export interface AxCommandServiceState {
  store: WorkflowStore;
  options: AxCommandServiceOptions;
  readGateway: AxCommandReadGateway;
  workflowGateway: AxWorkflowCommandGateway;
  discoveryGateway: DiscoveryCommandGateway;
  repairGateway: RepairCommandGateway;
  pendingJobs: Map<string, PendingJobDraft>;
}
