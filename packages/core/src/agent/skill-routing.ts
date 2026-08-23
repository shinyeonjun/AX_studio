import { CONNECTOR_IDS, getConnectorCatalogEntry } from '../catalog/connectors.js';
import { getCapability } from '../catalog/capabilities.js';
import { triggerCapabilityId } from '../catalog/capability-contracts.js';
import type {
  AgentContext,
  AgentRole,
  InvestigateAgentContext,
  CommandAgentContext,
} from './types.js';

// Only connectors with a real runtime implementation may influence the agent
// prompt. Catalog-only entries describe future contracts and must not be
// presented as executable design choices.
const KNOWN_CONNECTORS = new Set<string>(
  CONNECTOR_IDS.filter((connector) => getConnectorCatalogEntry(connector)?.runtimeAvailable),
);

function addKnownConnector(target: Set<string>, connector: unknown): void {
  if (typeof connector === 'string' && KNOWN_CONNECTORS.has(connector)) target.add(connector);
}

function addTriggerConnector(target: Set<string>, triggerType: unknown): void {
  if (typeof triggerType !== 'string') return;
  const capabilityId = triggerCapabilityId(triggerType);
  addKnownConnector(target, capabilityId ? getCapability(capabilityId)?.connector : undefined);
}

export function connectorSkillsForRole(role: AgentRole, context: AgentContext): string[] {
  if (role === 'command') {
    const selected = new Set<string>();
    (context as CommandAgentContext).connectedConnectors.forEach((connector) =>
      addKnownConnector(selected, connector),
    );
    return CONNECTOR_IDS.filter((connector) => selected.has(connector));
  }
  if (role === 'investigate') {
    const selected = new Set<string>();
    (context as InvestigateAgentContext).connectedConnectors.forEach((connector) =>
      addKnownConnector(selected, connector),
    );
    return CONNECTOR_IDS.filter((connector) => selected.has(connector));
  }

  return [];
}
