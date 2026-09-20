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

function normalizeConnectorAction(connector: string, action: string): string | undefined {
  const trimmed = action.trim();
  const versionAt = trimmed.lastIndexOf('@');
  const hasVersion = versionAt > 0 && /^\d+$/u.test(trimmed.slice(versionAt + 1));
  if (hasVersion) {
    if (Number(trimmed.slice(versionAt + 1)) !== 1) return undefined;
    action = trimmed.slice(0, versionAt);
  }
  const versionless = action.trim();
  if (versionless.startsWith(`${connector}.`)) {
    return versionless.slice(connector.length + 1);
  }
  return ACTION_ALIASES[connector]?.[versionless] ?? versionless;
}

/** Resolve a registered capability without depending on graph or canvas models. */
export function resolveCapability(
  connector: string,
  action: string,
): ConnectorCapability | undefined {
  const trimmed = action.trim();
  const normalized = normalizeConnectorAction(connector, action);
  if (!normalized) return undefined;
  const versionless = trimmed.replace(/@1$/u, '');
  const ids = new Set([
    normalized,
    `${connector}.${normalized}`,
    versionless,
  ]);
  return getCapabilitiesForConnector(connector).find((cap) => {
    return ids.has(cap.id) || ids.has(cap.id.slice(connector.length + 1));
  });
}
