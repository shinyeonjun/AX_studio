import type { ConnectorId } from '../catalog/connector-types.js';
import type { Connector } from './types.js';

export interface ModuleRegistration {
  id: ConnectorId;
  instantiate?: (config?: Record<string, unknown>) => Connector | null;
}

const modules = new Map<ConnectorId, ModuleRegistration>();

export function registerModule(registration: ModuleRegistration): void {
  modules.set(registration.id, registration);
}

export function getRegisteredModule(id: ConnectorId): ModuleRegistration | undefined {
  return modules.get(id);
}

export function listRegisteredModules(): ModuleRegistration[] {
  return [...modules.values()];
}

export function instantiateRegisteredConnector(
  id: ConnectorId,
  config?: Record<string, unknown>,
): Connector | null {
  const registration = modules.get(id);
  if (!registration?.instantiate) return null;
  return registration.instantiate(config);
}
