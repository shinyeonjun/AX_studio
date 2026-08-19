import { CAPABILITY_CATALOG } from '../connectors/capabilities.js';
import { capabilityActionName } from '../connectors/capability-graph.js';
import type { Connector, ConnectorContext } from '../connectors/types.js';

export async function performCapabilityRead(
  capabilityId: string,
  ctx: ConnectorContext,
  connectors: Record<string, Connector>,
  params: Record<string, unknown> = {},
): Promise<unknown> {
  const cap = CAPABILITY_CATALOG.find((item) => item.id === capabilityId);
  if (!cap || cap.kind !== 'read') return null;

  const connector = connectors[cap.connector];
  if (!connector) return null;

  const action = capabilityActionName(cap);
  const result = await connector.execute(action, params, ctx);
  return result.ok ? result.data : null;
}
