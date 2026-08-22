import { CAPABILITY_CATALOG, type ConnectorCapability } from '../../catalog/capabilities.js';
import { designCapabilities, isConnectorAlwaysOn } from '../../catalog/capability-graph.js';
import type { DesignToolContext, DesignToolHandler } from '../types.js';

function stringArg(args: Record<string, unknown>, name: string): string | undefined {
  const value = args[name];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function kindArg(args: Record<string, unknown>): ConnectorCapability['kind'] | undefined {
  const value = stringArg(args, 'kind');
  if (value === 'read' || value === 'write' || value === 'trigger') return value;
  return undefined;
}

function summarizeCapability(cap: ConnectorCapability, connectedConnectorIds: string[]) {
  return {
    id: cap.id,
    connector: cap.connector,
    kind: cap.kind,
    label: cap.label,
    description: cap.description,
    sideEffect: cap.sideEffect ?? 'NONE',
    params: cap.params.map((param) => ({
      name: param.name,
      label: param.label,
      required: param.required,
    })),
    io: cap.io ?? { inputs: {}, outputs: {} },
    connection: isConnectorAlwaysOn(cap.connector) || connectedConnectorIds.includes(cap.connector)
      ? 'ready'
      : 'required',
  };
}

export const capabilitiesList: DesignToolHandler = (ctx, args) => {
  const connector = stringArg(args, 'connector');
  const kind = kindArg(args);

  let caps = designCapabilities();
  if (connector) {
    caps = caps.filter((cap) => cap.connector === connector);
  }
  if (kind) {
    caps = caps.filter((cap) => cap.kind === kind);
  }

  return {
    capabilities: caps.map((cap) => summarizeCapability(cap, ctx.connectedConnectorIds)),
    catalogSize: CAPABILITY_CATALOG.length,
  };
};
