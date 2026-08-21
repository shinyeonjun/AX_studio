import { CONNECTOR_IDS, getConnectorCatalogEntry } from '../catalog/connectors.js';
import { getCapability } from '../catalog/capabilities.js';
import { triggerCapabilityId } from '../catalog/capability-contracts.js';
import type {
  AgentContext,
  AgentRole,
  InterviewAgentContext,
  InvestigateAgentContext,
  ReviseAgentContext,
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

function collectWorkflowConnectors(value: unknown, target: Set<string>): void {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((entry) => collectWorkflowConnectors(entry, target));
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (key === 'connector') addKnownConnector(target, child);
    if (key === 'type') addTriggerConnector(target, child);
    collectWorkflowConnectors(child, target);
  }
}

function interviewConnectorSkills(context: InterviewAgentContext): string[] {
  const selected = new Set<string>();
  const draft = context.workflow;
  const blank = draft.nodes.length === 0 && (!draft.triggerType || draft.triggerType === 'manual');

  if (blank) {
    context.connectedConnectors.forEach((connector) => addKnownConnector(selected, connector));
  } else {
    addTriggerConnector(selected, draft.triggerType);
    draft.nodes.forEach((node) => addKnownConnector(selected, node.connector));
  }

  return CONNECTOR_IDS.filter((connector) => selected.has(connector));
}

export function connectorSkillsForRole(role: AgentRole, context: AgentContext): string[] {
  if (role === 'interview') return interviewConnectorSkills(context as InterviewAgentContext);
  if (role === 'investigate') {
    const selected = new Set<string>();
    (context as InvestigateAgentContext).connectedConnectors.forEach((connector) =>
      addKnownConnector(selected, connector),
    );
    return CONNECTOR_IDS.filter((connector) => selected.has(connector));
  }

  const selected = new Set<string>();
  try {
    collectWorkflowConnectors(JSON.parse((context as ReviseAgentContext).workflowJson), selected);
  } catch {
    return [];
  }
  return CONNECTOR_IDS.filter((connector) => selected.has(connector));
}
