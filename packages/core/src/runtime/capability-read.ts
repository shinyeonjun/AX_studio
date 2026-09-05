import { getCapability } from '../catalog/capabilities.js';
import { capabilityActionName, readCapabilityMethodIssue } from '../catalog/capability-graph.js';
import type { Connector, ConnectorContext } from '../modules/types.js';
import { materializeStepOutputs } from './output-ports.js';

export async function performCapabilityRead(
  capabilityId: string,
  ctx: ConnectorContext,
  connectors: Record<string, Connector>,
  params: Record<string, unknown> = {},
): Promise<unknown> {
  const cap = getCapability(capabilityId);
  if (!cap || cap.kind !== 'read') return null;
  if (readCapabilityMethodIssue(cap, params)) return null;

  const connector = connectors[cap.connector];
  if (!connector) return null;

  const action = capabilityActionName(cap);
  const result = await connector.execute(action, params, ctx);
  if (!result.ok) return null;
  return cap.io?.outputs
    ? materializeStepOutputs(`capability:${capabilityId}`, cap.io.outputs, result.data)
    : result.data;
}
