import type { ConnectorCapability } from './capability-types.js';

const dynamicCapabilities = new Map<string, ConnectorCapability>();

export function registerDynamicCapabilities(caps: ConnectorCapability[]): void {
  for (const cap of caps) {
    dynamicCapabilities.set(cap.id, cap);
  }
}

/** OpenAPI and MCP each have one configured connection slot; refresh its catalog atomically. */
export function replaceDynamicCapabilitiesForConnector(
  connector: string,
  caps: ConnectorCapability[],
): void {
  for (const [id, capability] of dynamicCapabilities) {
    if (capability.connector === connector) dynamicCapabilities.delete(id);
  }
  registerDynamicCapabilities(caps);
}

export function clearDynamicCatalogForTests(): void {
  dynamicCapabilities.clear();
}

export function findDynamicCapability(id: string): ConnectorCapability | undefined {
  return dynamicCapabilities.get(id);
}

export function listDynamicCapabilities(): ConnectorCapability[] {
  return [...dynamicCapabilities.values()];
}
