import type { ArtifactStore } from '../../../store/artifact-store.js';
import type { WorkflowStore } from '../../../store/workflow-store.js';
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
  resolveConnectionConfig?: (connector: string, config: unknown) => Promise<unknown> | unknown;
  snapshotDir?: string;
  sourceReadsMax?: number;
  autoResume?: boolean;
}
