import type { ArtifactStore } from '../../store/artifact-store.js';
import type { WorkflowStore } from '../../store/workflow-store.js';
import type { WorkbookMaterializer } from '../../contracts/discovery-source.js';
import type { OutputObservation } from '../observation/schema.js';
import type { DiscoverySessionState } from '../schema.js';
import type { DiscoverySourceRegistry } from '../sources/registry.js';

export interface WorkDiscoveryServiceOptions {
  store: WorkflowStore;
  artifactStore?: ArtifactStore;
  resolveConnectionConfig?: (connector: string, config: unknown) => Promise<unknown> | unknown;
  snapshotDir?: string;
  sourceRegistry?: DiscoverySourceRegistry;
  sourceReadsMax?: number;
  autoResume?: boolean;
}

export interface DiscoveryRevisionConflict {
  error: 'discovery_revision_conflict';
  currentRevision: number;
}

export interface WorkDiscoveryRuntimeOptions {
  store: WorkflowStore;
  artifactStore: ArtifactStore;
  snapshotDir: string;
  sourceRegistry: DiscoverySourceRegistry;
  sourceReadsMax: number;
  materializeWorkbook: WorkbookMaterializer['readWorkbookFromPath'];
  resolveConnectionConfig?: (connector: string, config: unknown) => Promise<unknown> | unknown;
}

export interface WorkDiscoveryRuntime extends WorkDiscoveryRuntimeOptions {
  running: Set<string>;
  scheduleRun: (sessionId: string) => void;
  resumePendingSessions: () => void;
  resetForRecovery: (state: DiscoverySessionState) => DiscoverySessionState;
  transition: (
    state: DiscoverySessionState,
    to: DiscoverySessionState['status'],
  ) => DiscoverySessionState;
  patchState: (
    sessionId: string,
    patch: Partial<DiscoverySessionState>,
  ) => DiscoverySessionState;
  isCancelled: (sessionId: string) => boolean;
  observeOutputArtifact: (exampleId: string, artifactId: string) => OutputObservation[];
}
