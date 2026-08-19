import { CONNECTOR_CATALOG, type ConnectorId } from './catalog.js';
import { CAPABILITY_CATALOG, type ConnectorCapability } from './capabilities.js';

export function isConnectorAlwaysOn(connector: string): boolean {
  const entry = CONNECTOR_CATALOG[connector as ConnectorId];
  if (!entry) return false;
  return entry.alwaysReal || entry.connectionKind === 'builtin';
}

export function resolveCapability(connector: string, action: string): ConnectorCapability | undefined {
  const compact = action.replace(/^[a-z_]+\./, '');
  return CAPABILITY_CATALOG.find((cap) => {
    if (cap.connector !== connector) return false;
    const rest = cap.id.slice(connector.length + 1);
    return (
      rest === compact ||
      rest === action ||
      cap.id === action ||
      rest.endsWith(`.${compact}`) ||
      rest.split('.').pop() === compact
    );
  });
}

export function availableCapabilities(connectedConnectors: string[]): ConnectorCapability[] {
  return CAPABILITY_CATALOG.filter(
    (cap) => isConnectorAlwaysOn(cap.connector) || connectedConnectors.includes(cap.connector),
  );
}

export function formatCapabilitiesForPrompt(capabilities: ConnectorCapability[]): string {
  if (capabilities.length === 0) return '- (연결된 도구 없음. 설정에서 Gmail/Slack을 연결하세요.)';
  return capabilities
    .map((cap) => {
      const risk = cap.sideEffect ? `, sideEffect=${cap.sideEffect}` : '';
      const required = (cap.params ?? [])
        .filter((param) => param.required)
        .map((param) => param.name)
        .join(', ');
      const req = required ? `, requiredParams=${required}` : '';
      return `- ${cap.id}: ${cap.description} (${cap.kind}${risk}${req})`;
    })
    .join('\n');
}

export function capabilityActionName(cap: ConnectorCapability): string {
  return cap.id.slice(cap.connector.length + 1);
}

export function paramSlotId(cap: ConnectorCapability, paramName: string): string {
  return `${cap.id}.${paramName}`;
}
