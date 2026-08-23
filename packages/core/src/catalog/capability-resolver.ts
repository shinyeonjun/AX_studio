import { CAPABILITY_CATALOG, type ConnectorCapability } from './capabilities.js';

const ACTION_ALIASES: Record<string, Record<string, string>> = {
  slack: {
    send_message: 'message.send',
    post_message: 'message.send',
  },
  gmail: {
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

/** Resolve a packaged capability without depending on graph or canvas models. */
export function resolveCapability(
  connector: string,
  action: string,
): ConnectorCapability | undefined {
  const normalized = normalizeConnectorAction(connector, action);
  const compact = normalized.replace(/^[a-z_]+\./, '');
  return CAPABILITY_CATALOG.find((cap) => {
    if (cap.connector !== connector) return false;
    const rest = cap.id.slice(connector.length + 1);
    return (
      rest === compact ||
      rest === normalized ||
      cap.id === normalized ||
      cap.id === `${connector}.${normalized}` ||
      rest.endsWith(`.${compact}`) ||
      rest.split('.').pop() === compact
    );
  });
}
