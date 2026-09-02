import { getCapabilitiesForConnector, type ConnectorCapability } from './capabilities.js';

const ACTION_ALIASES: Record<string, Record<string, string>> = {
  slack: {
    send: 'message.send',
    send_message: 'message.send',
    post_message: 'message.send',
  },
  gmail: {
    send: 'message.send',
    send_message: 'message.send',
  },
};

function normalizeConnectorAction(connector: string, action: string): string {
  const trimmed = action.trim();
  if (trimmed.startsWith(`${connector}.`)) {
    return trimmed.slice(connector.length + 1);
  }
  return ACTION_ALIASES[connector]?.[trimmed] ?? trimmed;
}

/** Resolve a registered capability without depending on graph or canvas models. */
export function resolveCapability(
  connector: string,
  action: string,
): ConnectorCapability | undefined {
  const trimmed = action.trim();
  const normalized = normalizeConnectorAction(connector, action);
  const ids = new Set([
    normalized,
    `${connector}.${normalized}`,
    trimmed,
  ]);
  return getCapabilitiesForConnector(connector).find((cap) => {
    return ids.has(cap.id) || ids.has(cap.id.slice(connector.length + 1));
  });
}
