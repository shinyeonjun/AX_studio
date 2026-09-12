import type {
  DiscoverySourceProvider,
  WorkbookMaterializer,
} from '../../contracts/discovery-source.js';
import { DiscoverySourceRegistry } from './registry.js';
import { InputArtifactDiscoverySourceProvider } from './input-artifact-provider.js';

export interface DiscoverySourceAssemblyOptions {
  providers?: readonly DiscoverySourceProvider[];
  materializeWorkbook?: WorkbookMaterializer['readWorkbookFromPath'];
}

export function createDefaultDiscoverySourceRegistry(
  options: DiscoverySourceAssemblyOptions = {},
): DiscoverySourceRegistry {
  const inputProviders = options.materializeWorkbook
    ? [new InputArtifactDiscoverySourceProvider({ materializeWorkbook: options.materializeWorkbook })]
    : [];
  return new DiscoverySourceRegistry([
    ...inputProviders,
    ...(options.providers ?? []),
  ]);
}

export * from './types.js';
export * from './registry.js';
export * from './input-artifact-provider.js';
