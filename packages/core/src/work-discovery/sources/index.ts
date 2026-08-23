import type { ArtifactStore } from '../../store/artifact-store.js';
import type { WorkflowStore } from '../../store/workflow-store.js';
import type { DiscoverySourceProvider } from '../../contracts/discovery-source.js';
import { ALL_MODULE_PACKAGES } from '../../modules/packages/catalog.js';
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
