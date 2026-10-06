import type { ArtifactStore } from '../../../../persistence/artifact-store.js';
import type { DecisionEngine } from '../../../../contracts/decision.js';
import type {
  DiscoverySourceProvider,
  WorkbookMaterializer,
} from '../../../../contracts/discovery-source.js';
import type { DiscoverySourceRegistry } from '../../../../work-discovery/sources/registry.js';
import type { AxCommand, AxCommandIssue, AxCommandResult } from '../schema.js';

export type DiscoveryCommandResult = [AxCommandResult['status'], unknown, AxCommandIssue[]?];

/** Caller boundary for discovery commands; a chat caller always supplies its workspace session. */
export interface DiscoveryCommandContext {
  workspaceSessionId?: string;
}

export interface DiscoveryCommandGateway {
  setDecisionEngine(decisionEngine?: DecisionEngine): void;
  start(command: AxCommand, context?: DiscoveryCommandContext): DiscoveryCommandResult;
  inspect(command: AxCommand, context?: DiscoveryCommandContext): DiscoveryCommandResult;
  cancel(command: AxCommand, context?: DiscoveryCommandContext): DiscoveryCommandResult;
  retry(command: AxCommand, context?: DiscoveryCommandContext): DiscoveryCommandResult;
  answer(command: AxCommand, context?: DiscoveryCommandContext): DiscoveryCommandResult;
  publish(command: AxCommand, context?: DiscoveryCommandContext): DiscoveryCommandResult;
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
