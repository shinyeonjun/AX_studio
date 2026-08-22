import { CONNECTOR_CATALOG, type ConnectorId } from './connectors.js';
import { CAPABILITY_CATALOG, type ConnectorCapability } from './capabilities.js';
import { triggerCapabilityId } from './capability-contracts.js';
export { resolveCapability } from './capability-resolver.js';
import { resolveCapability } from './capability-resolver.js';

export function isConnectorAlwaysOn(connector: string): boolean {
  const entry = CONNECTOR_CATALOG[connector as ConnectorId];
  if (!entry) return false;
  return entry.runtimeAvailable && (entry.alwaysReal || entry.connectionKind === 'builtin');
}

export function availableCapabilities(connectedConnectors: string[]): ConnectorCapability[] {
  return CAPABILITY_CATALOG.filter(
    (cap) =>
      CONNECTOR_CATALOG[cap.connector as ConnectorId]?.runtimeAvailable === true &&
      (isConnectorAlwaysOn(cap.connector) || connectedConnectors.includes(cap.connector)),
  );
}

/** Design-time catalog: packaged actions are visible before authentication. */
export function designCapabilities(): ConnectorCapability[] {
  return CAPABILITY_CATALOG.filter(
    (cap) => CONNECTOR_CATALOG[cap.connector as ConnectorId]?.runtimeAvailable === true,
  );
}

/** Investigate: read caps from connected connectors only. */
export function relevantCapabilitiesForInvestigate(connectedConnectors: string[]): ConnectorCapability[] {
  return availableCapabilities(connectedConnectors).filter((cap) => cap.kind === 'read');
}

export function formatCapabilitiesForPrompt(
  capabilities: ConnectorCapability[],
  connectedConnectors?: string[],
): string {
  if (capabilities.length === 0) return '- (패키징된 도구 없음)';
  return capabilities
    .map((cap) => {
      const connection =
        connectedConnectors && !isConnectorAlwaysOn(cap.connector) && !connectedConnectors.includes(cap.connector)
          ? ', connection=required'
          : ', connection=ready';
      const risk = cap.sideEffect ? `, sideEffect=${cap.sideEffect}` : '';
      const required = (cap.params ?? [])
        .filter((param) => param.required)
        .map((param) => param.name)
        .join(', ');
      const req = required ? `, requiredParams=${required}` : '';
      const params = (cap.params ?? [])
        .map((param) => `${param.name}${param.required ? ':required' : ':optional'}`)
        .join(', ');
      const paramText = params ? `, params=${params}` : '';
      const formatPorts = (ports: Record<string, string> | undefined): string =>
        Object.entries(ports ?? {})
          .map(([name, type]) => `${name}:${type}`)
          .join(', ');
      const inputs = formatPorts(cap.io?.inputs);
      const outputs = formatPorts(cap.io?.outputs);
      const io = inputs || outputs ? `, inputs=[${inputs}], outputs=[${outputs}]` : '';
      return `- ${cap.id}@1: ${cap.description} (connector=${cap.connector}, action=${capabilityActionName(cap)}, kind=${cap.kind}${connection}${risk}${req}${paramText}${io})`;
    })
    .join('\n');
}

export function capabilityActionName(cap: ConnectorCapability): string {
  return cap.id.slice(cap.connector.length + 1);
}

export function paramSlotId(cap: ConnectorCapability, paramName: string): string {
  return `${cap.id}.${paramName}`;
}
