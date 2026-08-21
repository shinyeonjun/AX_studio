import type { ConnectorCapability } from '../catalog/capability-types.js';
import { capabilityActionName, resolveCapability } from '../catalog/capability-graph.js';
import { CAPABILITY_CATALOG } from '../catalog/capabilities.js';

/** Versioned, serializable action contract referenced by a workflow step. */
export interface ActionDefinition {
  id: string;
  version: number;
  connector: string;
  action: string;
  kind: ConnectorCapability['kind'];
  sideEffect: ConnectorCapability['sideEffect'];
  params: ConnectorCapability['params'];
  io?: ConnectorCapability['io'];
}

export function actionRefFor(connector: string, action: string): string {
  const id = resolveCapability(connector, action)?.id ?? `${connector}.${action}`;
  return `${id}@1`;
}

export function actionDefinitionFromCapability(capability: ConnectorCapability): ActionDefinition {
  return {
    id: capability.id,
    version: 1,
    connector: capability.connector,
    action: capabilityActionName(capability),
    kind: capability.kind,
    sideEffect: capability.sideEffect,
    params: capability.params,
    io: capability.io,
  };
}

export function resolveActionDefinition(ref: string): ActionDefinition | undefined {
  const normalized = ref.trim();
  const at = normalized.lastIndexOf('@');
  const hasVersion = at > 0 && /^\d+$/.test(normalized.slice(at + 1));
  const id = hasVersion ? normalized.slice(0, at) : normalized;
  const version = hasVersion ? Number(normalized.slice(at + 1)) : 1;
  if (!Number.isInteger(version) || version !== 1) return undefined;
  const capability = CAPABILITY_CATALOG.find((entry) => entry.id === id);
  return capability ? actionDefinitionFromCapability(capability) : undefined;
}

export function validateActionParams(
  definition: ActionDefinition,
  params: Record<string, unknown>,
): string[] {
  const missing = definition.params
    .filter((param) => param.required)
    .filter((param) => {
      const value = params[param.name];
      return value == null || (typeof value === 'string' && !value.trim());
    })
    .map((param) => param.name);

  for (const [port, type] of Object.entries(definition.io?.inputs ?? {})) {
    if (missing.includes(port)) continue;
    const value = params[port];
    if (type === 'TextArtifact' && (typeof value !== 'string' || !value.trim())) missing.push(port);
  }

  return [...new Set(missing)];
}

export function listActionDefinitions(): ActionDefinition[] {
  return CAPABILITY_CATALOG
    .filter((capability) => capability.kind !== 'trigger')
    .map(actionDefinitionFromCapability);
}
