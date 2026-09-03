import { WorkDiscoveryService } from '../../../work-discovery/service.js';
import type { WorkflowStore } from '../../../store/workflow-store.js';
import type { AxCommand } from '../schema.js';
import type { DiscoveryCommandGateway, DiscoveryGatewayOptions } from './contracts.js';
import { answer, cancel, inspect, publish, retry, start } from './handlers.js';

export function createDiscoveryCommandGateway(
  store: WorkflowStore,
  options: DiscoveryGatewayOptions = {},
): DiscoveryCommandGateway {
  const service = new WorkDiscoveryService({
    store,
    artifactStore: options.artifactStore,
    resolveConnectionConfig: options.resolveConnectionConfig,
    snapshotDir: options.snapshotDir,
    sourceReadsMax: options.sourceReadsMax,
    autoResume: options.autoResume,
  });
  return {
    start: (command: AxCommand) => start(service, command),
    inspect: (command: AxCommand) => inspect(service, command),
    cancel: (command: AxCommand) => cancel(service, command),
    retry: (command: AxCommand) => retry(service, command),
    answer: (command: AxCommand) => answer(service, command),
    publish: (command: AxCommand) => publish(service, command),
  };
}
