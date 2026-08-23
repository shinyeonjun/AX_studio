import type { ArtifactStore } from '../store/artifact-store.js';
import type { WorkflowStore } from '../store/workflow-store.js';
import type { TableArtifact } from './artifacts/table.js';

export interface ExplorationBudget {
  sourceReadsUsed: number;
  sourceReadsMax: number;
}

export interface DiscoverySourceDescriptor {
  id: string;
  connector: string;
  label: string;
  kind: 'table' | 'workbook' | 'document' | 'email' | 'unknown';
  relevance: number;
  profileSummary?: string;
  metadata?: Record<string, unknown>;
}

export interface DiscoveryObservationRef {
  path: string;
  label?: string;
  required?: boolean;
}

export interface DiscoverySourceContext {
  store: WorkflowStore;
  artifactStore: ArtifactStore;
  snapshotDir: string;
  exampleId: string;
  observations: DiscoveryObservationRef[];
  inputArtifactIds: string[];
  budget: ExplorationBudget;
}

export interface SourceProfileResult {
  descriptor: DiscoverySourceDescriptor;
  table: TableArtifact;
  fingerprint: string;
  queryJson?: string;
}

export interface DiscoverySourceProvider {
  readonly connector: string;
  listSources(ctx: DiscoverySourceContext): Promise<DiscoverySourceDescriptor[]>;
  profileSource(ctx: DiscoverySourceContext, sourceId: string): Promise<SourceProfileResult | null>;
}

export interface WorkbookMaterializer {
  readWorkbookFromPath(path: string): {
    workbook: import('./artifacts/workbook.js').WorkbookArtifact;
    tables: Record<string, TableArtifact>;
  };
}
