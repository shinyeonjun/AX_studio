import type { ArtifactStore } from '../../store/artifact-store.js';
import type { WorkflowStore } from '../../store/workflow-store.js';
import type { TableArtifact } from '../../contracts/artifacts/table.js';
import type { WorkbookMaterializer } from '../../contracts/discovery-source.js';
import type { OutputObservation } from '../observation/schema.js';
import type { DiscoverySessionState } from '../schema.js';
import type { DiscoverySourceRegistry } from '../sources/registry.js';

export type DiscoveryPipelineExample = ReturnType<WorkflowStore['listDiscoveryExamples']>[number];

export interface DiscoveryPipelineHost {
  readonly store: WorkflowStore;
  readonly artifactStore: ArtifactStore;
  readonly sourceRegistry: DiscoverySourceRegistry;
  readonly snapshotDir: string;
  readonly materializeWorkbook: WorkbookMaterializer['readWorkbookFromPath'];
  readonly resolveConnectionConfig?: (connector: string, config: unknown) => Promise<unknown> | unknown;
  readonly running: Set<string>;
  readonly loadPersistedSnapshotTables: (
    state: DiscoverySessionState,
    exampleIds: string[],
  ) => Record<string, Record<string, TableArtifact>> | undefined;
  readonly snapshotRecordId: (sessionId: string, exampleId: string, sourceId: string) => string;
  readonly resetForRecovery: (state: DiscoverySessionState) => DiscoverySessionState;
  readonly transition: (state: DiscoverySessionState, to: DiscoverySessionState['status']) => DiscoverySessionState;
  readonly patchState: (sessionId: string, patch: Partial<DiscoverySessionState>) => DiscoverySessionState;
  readonly isCancelled: (sessionId: string) => boolean;
  readonly observeOutputArtifact: (exampleId: string, artifactId: string) => OutputObservation[];
}
