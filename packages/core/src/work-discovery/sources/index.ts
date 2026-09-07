import type { ArtifactStore } from '../../persistence/artifact-store.js';
import type { WorkflowStore } from '../../persistence/workflow-store.js';
import { ALL_MODULE_PACKAGES } from '../../connectors/packages/catalog.js';
import { DiscoverySourceRegistry } from './registry.js';
import { InputArtifactDiscoverySourceProvider } from './input-artifact-provider.js';

export function createDefaultDiscoverySourceRegistry(
  _store: WorkflowStore,
  _artifactStore: ArtifactStore,
): DiscoverySourceRegistry {
  const moduleProviders = ALL_MODULE_PACKAGES.flatMap((pkg) =>
    pkg.discoverySource ? [pkg.discoverySource] : [],
  );
  const materializeWorkbook = ALL_MODULE_PACKAGES.find((pkg) => pkg.id === 'local_sheet')?.materializeWorkbook;
  if (!materializeWorkbook) {
    throw new Error('local_sheet module must register materializeWorkbook');
  }
  return new DiscoverySourceRegistry([
    new InputArtifactDiscoverySourceProvider({ materializeWorkbook }),
    ...moduleProviders,
  ]);
}

export * from './types.js';
export * from './registry.js';
export * from './input-artifact-provider.js';
