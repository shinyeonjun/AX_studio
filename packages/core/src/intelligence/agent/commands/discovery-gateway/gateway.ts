import { WorkDiscoveryService } from '../../../../work-discovery/service.js';
import type { WorkflowStore } from '../../../../persistence/workflow-store.js';
import type { AxCommand } from '../schema.js';
import type { DiscoveryCommandContext, DiscoveryCommandGateway, DiscoveryGatewayOptions } from './contracts.js';
import { DiscoverySessionBindings } from './bindings.js';
import { answer, cancel, inspect, publish, retry, start } from './handlers.js';

export function createDiscoveryCommandGateway(
  store: WorkflowStore,
  options: DiscoveryGatewayOptions = {},
): DiscoveryCommandGateway {
  const service = new WorkDiscoveryService({
    store,
    artifactStore: options.artifactStore,
    decisionEngine: options.decisionEngine,
    resolveConnectionConfig: options.resolveConnectionConfig,
    snapshotDir: options.snapshotDir,
    sourceRegistry: options.sourceRegistry,
    sourceProviders: options.sourceProviders,
    materializeWorkbook: options.materializeWorkbook,
    sourceReadsMax: options.sourceReadsMax,
    autoResume: options.autoResume,
  });
  const bindings = new DiscoverySessionBindings();
  const bound = (
    handler: (service: WorkDiscoveryService, command: AxCommand) => ReturnType<typeof inspect>,
  ) => (command: AxCommand, context: DiscoveryCommandContext = {}) =>
    bindings.reject(command, context) ?? handler(service, command);
  return {
    setDecisionEngine: (decisionEngine) => service.setDecisionEngine(decisionEngine),
    start: (command: AxCommand, context: DiscoveryCommandContext = {}) =>
      bindings.record(start(service, command), context),
    inspect: bound(inspect),
    cancel: bound(cancel),
    retry: bound(retry),
    answer: bound(answer),
    publish: bound(publish),
  };
}
