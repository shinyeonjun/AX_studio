import type { ArtifactStore } from '../../../../persistence/artifact-store.js';
import type { WorkflowStore } from '../../../../persistence/workflow-store.js';
import type { DecisionEngine } from '../../../../contracts/decision.js';
import type {
  DiscoverySourceProvider,
  WorkbookMaterializer,
} from '../../../../contracts/discovery-source.js';
import type { DiscoverySourceRegistry } from '../../../../work-discovery/sources/registry.js';
import type { WorkspaceSourceService } from '../../../../persistence/workspace-source-service.js';
import type { WorkflowIR } from '../../../../workflow/schema.js';
import type { AxCommandExecutionContext } from '../access.js';
import type { AxCommandReadContext, AxCommandReadGateway } from '../read-gateway.js';
import type { DiscoveryCommandGateway } from '../discovery-gateway.js';
import type { PendingJobDraft } from '../job-registration/contract.js';
import type { RepairCommandGateway } from '../repair-gateway.js';
import type { AxWorkflowCommandGateway } from '../workflow-gateway/contract.js';

export interface AxCommandServiceOptions {
  removeWorkflow?: (workflowId: string) => Promise<void> | void;
  runWorkflow?: (workflowId: string) => Promise<unknown>;
  enqueueOnce?: (
    workflow: WorkflowIR,
    options?: { workspaceSessionId?: string },
  ) => Promise<unknown> | unknown;
  readGateway?: AxCommandReadGateway;
  artifactStore?: ArtifactStore;
  workspaceSources?: WorkspaceSourceService;
  resolveConnectionConfig?: (connector: string, config: unknown) => Promise<unknown> | unknown;
  discoverySourceRegistry?: DiscoverySourceRegistry;
  discoverySourceProviders?: readonly DiscoverySourceProvider[];
  discoveryWorkbookMaterializer?: WorkbookMaterializer['readWorkbookFromPath'];
  decisionEngine?: DecisionEngine;
  autoResumeDiscovery?: boolean;
  repairSnapshotRoot?: string;
}

export interface AxCommandExecuteOptions {
  abortSignal?: AbortSignal;
  /** The current user utterance, supplied by chat so host-only intent guards can run. */
  userMessage?: string;
  designToolContext?: AxCommandReadContext;
  designToolContextFactory?: () => AxCommandReadContext;
  executionContext?: AxCommandExecutionContext;
  workspaceSessionId?: string;
  currentWorkflowId?: string;
  /** Only a host-rendered confirm_context action may enable this mutation. */
  allowContextUpdate?: boolean;
  /** Only a host-rendered confirm_job action may enable this mutation. */
  allowJobCommit?: boolean;
  /** Opaque token from the exact host-rendered confirm_job action. */
  jobCommitConfirmationToken?: string;
  /** Host/Jev-owned snapshot for an agent capability read. */
  readAuthorization?: {
    capabilityId: string;
    params: Record<string, unknown>;
  };
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
