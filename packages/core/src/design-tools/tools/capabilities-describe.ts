import { getCapability } from '../../catalog/capabilities.js';
import { availableCapabilities, designCapabilities } from '../../catalog/capability-graph.js';
import type { DesignToolContext, DesignToolHandler } from '../types.js';

function stringArg(args: Record<string, unknown>, name: string): string | undefined {
  const value = args[name];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export const capabilitiesDescribe: DesignToolHandler = (ctx, args) => {
  const id = stringArg(args, 'id');
  if (!id) {
    throw new Error('id_required');
  }

  const cap = getCapability(id);
  if (!cap) {
    throw new Error('capability_not_found');
  }

  if (!designCapabilities().some((entry) => entry.id === id)) {
    return { id, available: false, reason: 'capability_not_packaged' };
  }

  const available = availableCapabilities(ctx.connectedConnectorIds);
  if (!available.some((entry) => entry.id === id)) {
    return {
      id,
      available: false,
      reason: 'connector_not_connected_or_builtin_only',
      capability: {
        id: cap.id,
        connector: cap.connector,
        kind: cap.kind,
        label: cap.label,
        description: cap.description,
        sideEffect: cap.sideEffect ?? 'NONE',
        params: cap.params,
        io: cap.io ?? { inputs: {}, outputs: {} },
      },
    };
  }

  return {
    id,
    available: true,
    capability: {
      id: cap.id,
      connector: cap.connector,
      kind: cap.kind,
      label: cap.label,
      description: cap.description,
      sideEffect: cap.sideEffect ?? 'NONE',
      params: cap.params,
      io: cap.io ?? { inputs: {}, outputs: {} },
    },
  };
};
