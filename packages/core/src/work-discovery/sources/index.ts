import type { ArtifactStore } from '../../store/artifact-store.js';
import type { WorkflowStore } from '../../store/workflow-store.js';
import { DiscoverySourceRegistry } from './registry.js';
import { InputArtifactDiscoverySourceProvider } from './input-artifact-provider.js';
import { LocalSheetDiscoverySourceProvider } from './local-sheet-provider.js';
import { RdbDiscoverySourceProvider } from './rdb-provider.js';

export function createDefaultDiscoverySourceRegistry(
  store: WorkflowStore,
  artifactStore: ArtifactStore,
): DiscoverySourceRegistry {
  return new DiscoverySourceRegistry([
    new InputArtifactDiscoverySourceProvider(),
    new LocalSheetDiscoverySourceProvider(),
    new RdbDiscoverySourceProvider(),
  ]);
}

export * from './types.js';
export * from './registry.js';
export * from './rdb-provider.js';
export * from './local-sheet-provider.js';
export * from './input-artifact-provider.js';
