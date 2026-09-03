import type { WorkflowStore } from '../../../store/workflow-store.js';
import { createDesignToolReadGateway } from '../read-gateway.js';
import { createDiscoveryCommandGateway } from '../discovery-gateway.js';
import { createRepairCommandGateway } from '../repair-gateway.js';
import { createWorkflowCommandGateway } from '../workflow-gateway.js';
import type {
  AxCommandServiceOptions,
  AxCommandServiceState,
} from './contracts.js';

export function createCommandServiceState(
  store: WorkflowStore,
  options: AxCommandServiceOptions = {},
): AxCommandServiceState {
  return {
    store,
    options,
    readGateway: options.readGateway ?? createDesignToolReadGateway(store),
    workflowGateway: createWorkflowCommandGateway(store, options),
    discoveryGateway: createDiscoveryCommandGateway(store, {
      artifactStore: options.artifactStore,
      resolveConnectionConfig: options.resolveConnectionConfig,
      autoResume: options.autoResumeDiscovery,
    }),
    repairGateway: createRepairCommandGateway(store, {
      snapshotRoot: options.repairSnapshotRoot,
    }),
    pendingJobs: new Map(),
  };
}
