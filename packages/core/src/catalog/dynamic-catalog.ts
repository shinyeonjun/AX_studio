import type { ConnectorCapability } from './capability-types.js';

const dynamicCapabilities = new Map<string, ConnectorCapability>();

export function registerDynamicCapabilities(caps: ConnectorCapability[]): void {
  for (const cap of caps) {
    dynamicCapabilities.set(cap.id, cap);
  }
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
