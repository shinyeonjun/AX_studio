import type { WorkflowStore } from '../../../../persistence/workflow-store.js';
import { createDesignToolReadGateway } from '../read-gateway.js';
import { createDiscoveryCommandGateway } from '../discovery-gateway.js';
import { createRepairCommandGateway } from '../repair-gateway.js';
import { createWorkflowCommandGateway } from '../workflow-gateway.js';
import type {
  AxCommandServiceOptions,
  AxCommandServiceState,
  PendingMutation,
} from './contracts.js';
import type { PendingJobDraft } from '../job-registration/contract.js';

/** Pending drafts and confirmations kept per conversation; the oldest goes past this many. */
export const MAX_PENDING_PER_KIND = 128;

export function createCommandServiceState(
  store: WorkflowStore,
  options: AxCommandServiceOptions = {},
): AxCommandServiceState {
  let pendingJobs: AxCommandServiceState['pendingJobs'] | undefined;
  let pendingMutations: AxCommandServiceState['pendingMutations'] | undefined;
  return {
    store,
    options,
    readGateway: options.readGateway ?? createDesignToolReadGateway(store),
    workflowGateway: createWorkflowCommandGateway(store, options),
    discoveryGateway: createDiscoveryCommandGateway(store, {
      artifactStore: options.artifactStore,
      decisionEngine: options.decisionEngine,
      resolveConnectionConfig: options.resolveConnectionConfig,
      sourceRegistry: options.discoverySourceRegistry,
      sourceProviders: options.discoverySourceProviders,
      materializeWorkbook: options.discoveryWorkbookMaterializer,
      autoResume: options.autoResumeDiscovery,
    }),
    repairGateway: createRepairCommandGateway(store, {
      snapshotRoot: options.repairSnapshotRoot,
    }),
    // Opened on first use: a job draft or a confirmation card still in the chat works after a restart.
    get pendingJobs() {
      return (pendingJobs ??= store.chatHostState<PendingJobDraft>('pending_job', MAX_PENDING_PER_KIND));
    },
    get pendingMutations() {
      return (pendingMutations ??= store.chatHostState<PendingMutation>('pending_mutation', MAX_PENDING_PER_KIND));
    },
  };
}
