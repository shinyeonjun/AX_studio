import { getCapability } from '../catalog/capabilities.js';
import { capabilityActionName } from '../catalog/capability-graph.js';
import { isPlainChatSideEffectAllowed } from '../platform/side-effect-policy.js';
import { citationsFromSearchHits } from '../platform/citations.js';
import type { ConnectorContext } from '../modules/types.js';
import type { DesignToolContext } from './types.js';

function noopLog(): void {
  // design-tool reads do not persist execution logs
}

export interface CapabilityInvokeEnvelope {
  capabilityId: string;
  data: unknown;
  citations: ReturnType<typeof citationsFromSearchHits>;
  untrusted: boolean;
}

export async function invokeReadCapability(
  ctx: DesignToolContext,
  capabilityId: string,
  params: Record<string, unknown>,
): Promise<CapabilityInvokeEnvelope> {
  const id = capabilityId.trim();
  if (!id) throw new Error('capability_id_required');

  const cap = getCapability(id);
  if (!cap) throw new Error('capability_not_found');
  if (cap.kind !== 'read') throw new Error('capability_not_readable');

  if (!isPlainChatSideEffectAllowed(cap.sideEffect)) {
    throw new Error('capability_not_allowed_in_plain_chat');
  }

  if (!ctx.connectedConnectorIds.includes(cap.connector)) {
    throw new Error('connector_not_connected');
  }

  const connector = ctx.connectors?.[cap.connector];
  if (!connector) throw new Error('connector_not_available');

  const connectorCtx: ConnectorContext = {
    executionId: 'design-tool',
    variables: {},
    log: noopLog,
  };

  const result = await connector.execute(capabilityActionName(cap), params, connectorCtx);
  if (!result.ok) {
    throw new Error(result.error ?? 'capability_invoke_failed');
  }

  const data = result.data;
  const citations =
    data &&
    typeof data === 'object' &&
    !Array.isArray(data) &&
    Array.isArray((data as { hits?: unknown }).hits)
      ? citationsFromSearchHits((data as { hits: import('../platform/knowledge.js').SearchHit[] }).hits)
      : [];

  return {
    capabilityId: id,
    data,
    citations,
    untrusted: true,
  };
}
