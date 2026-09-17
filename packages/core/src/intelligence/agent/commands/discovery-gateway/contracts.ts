import type { ArtifactStore } from '../../../../persistence/artifact-store.js';
import type { DecisionEngine } from '../../../../contracts/decision.js';
import type {
  DiscoverySourceProvider,
  WorkbookMaterializer,
} from '../../../../contracts/discovery-source.js';
import type { DiscoverySourceRegistry } from '../../../../work-discovery/sources/registry.js';
import type { AxCommand, AxCommandIssue, AxCommandResult } from '../schema.js';

export type DiscoveryCommandResult = [AxCommandResult['status'], unknown, AxCommandIssue[]?];

export interface DiscoveryCommandGateway {
  start(command: AxCommand): DiscoveryCommandResult;
  inspect(command: AxCommand): DiscoveryCommandResult;
  cancel(command: AxCommand): DiscoveryCommandResult;
  retry(command: AxCommand): DiscoveryCommandResult;
  answer(command: AxCommand): DiscoveryCommandResult;
  publish(command: AxCommand): DiscoveryCommandResult;
}

export interface DiscoveryGatewayOptions {
  artifactStore?: ArtifactStore;
  decisionEngine?: DecisionEngine;
  resolveConnectionConfig?: (connector: string, config: unknown) => Promise<unknown> | unknown;
  snapshotDir?: string;
  sourceRegistry?: DiscoverySourceRegistry;
  sourceProviders?: readonly DiscoverySourceProvider[];
  materializeWorkbook?: WorkbookMaterializer['readWorkbookFromPath'];
  sourceReadsMax?: number;
  autoResume?: boolean;
}
