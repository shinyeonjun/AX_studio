import type { ArtifactStore } from '../../persistence/artifact-store.js';
import type { WorkflowStore } from '../../persistence/workflow-store.js';
import type { DecisionEngine } from '../../contracts/decision.js';
import type {
  DiscoverySourceProvider,
  WorkbookMaterializer,
} from '../../contracts/discovery-source.js';
import type { OutputObservation } from '../observation/schema.js';
import type { DiscoverySessionState } from '../schema.js';
import type { DiscoverySourceRegistry } from '../sources/registry.js';

export interface WorkDiscoveryServiceOptions {
  store: WorkflowStore;
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

export interface DiscoveryRevisionConflict {
  error: 'discovery_revision_conflict';
  currentRevision: number;
}

export interface WorkDiscoveryRuntimeOptions {
  store: WorkflowStore;
  artifactStore: ArtifactStore;
  decisionEngine?: DecisionEngine;
  snapshotDir: string;
  sourceRegistry: DiscoverySourceRegistry;
  sourceReadsMax: number;
  materializeWorkbook: WorkbookMaterializer['readWorkbookFromPath'];
  resolveConnectionConfig?: (connector: string, config: unknown) => Promise<unknown> | unknown;
}

export interface WorkDiscoveryRuntime extends WorkDiscoveryRuntimeOptions {
  running: Set<string>;
  setDecisionEngine: (decisionEngine?: DecisionEngine) => void;
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
  observeOutputArtifact: (exampleId: string, artifactId: string) => OutputObservation[] | Promise<OutputObservation[]>;
}
