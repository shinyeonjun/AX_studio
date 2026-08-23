import type { ArtifactStore } from '../../store/artifact-store.js';
import type { WorkflowStore } from '../../store/workflow-store.js';
import type { TableArtifact } from '../../contracts/artifacts/table.js';
import type { OutputObservation } from '../observation/schema.js';
import type { SourceDescriptor } from '../schema.js';
import type { ExplorationBudget } from '../exploration/adapters.js';

export interface DiscoverySourceContext {
  store: WorkflowStore;
  artifactStore: ArtifactStore;
  snapshotDir: string;
  exampleId: string;
  observations: OutputObservation[];
  inputArtifactIds: string[];
  budget: ExplorationBudget;
}

export interface SourceProfileResult {
  descriptor: SourceDescriptor;
  table: TableArtifact;
  fingerprint: string;
  queryJson?: string;
}

export interface DiscoverySourceProvider {
  readonly connector: string;
  listSources(ctx: DiscoverySourceContext): Promise<SourceDescriptor[]>;
  profileSource(ctx: DiscoverySourceContext, sourceId: string): Promise<SourceProfileResult | null>;
}
