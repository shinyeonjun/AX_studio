import { CONNECTOR_CATALOG, type ConnectorId } from './connectors.js';
import { CAPABILITY_CATALOG, type ConnectorCapability } from './capabilities.js';
import type { InterviewDraft, WorkflowNode } from '../interview/workflow-schema.js';

export function isConnectorAlwaysOn(connector: string): boolean {
  const entry = CONNECTOR_CATALOG[connector as ConnectorId];
  if (!entry) return false;
  return entry.alwaysReal || entry.connectionKind === 'builtin';
}

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

export function normalizeWorkflowActionNode(node: WorkflowNode): WorkflowNode {
  if (node.type !== 'action' || !node.connector?.trim() || !node.action?.trim()) return node;
  const connector = node.connector.trim();
  const cap = resolveCapability(connector, node.action);
  if (!cap) return node;
  return {
    ...node,
    connector: cap.connector,
    action: capabilityActionName(cap),
  };
}

export function resolveCapability(connector: string, action: string): ConnectorCapability | undefined {
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

export function availableCapabilities(connectedConnectors: string[]): ConnectorCapability[] {
  return CAPABILITY_CATALOG.filter(
    (cap) => isConnectorAlwaysOn(cap.connector) || connectedConnectors.includes(cap.connector),
  );
}

const TRIGGER_CAPABILITY_BY_TYPE: Record<string, string> = {
  'gmail.new_message': 'gmail.new_message',
  'slack.new_message': 'slack.new_message',
};

function capabilityIdFromActionNode(node: WorkflowNode): string | undefined {
  if (node.type !== 'action' || !node.connector || !node.action) return undefined;
  return resolveCapability(node.connector, node.action)?.id;
}

function collectDraftCapabilityIds(draft: InterviewDraft): Set<string> {
  const ids = new Set<string>();
  for (const node of draft.nodes) {
    const capId = capabilityIdFromActionNode(node);
    if (capId) ids.add(capId);
  }
  const triggerCap = TRIGGER_CAPABILITY_BY_TYPE[draft.triggerType];
  if (triggerCap) ids.add(triggerCap);
  return ids;
}

function expandWithConnectorReads(
  ids: Set<string>,
  available: ConnectorCapability[],
): Set<string> {
  const expanded = new Set(ids);
  for (const id of ids) {
    const cap = CAPABILITY_CATALOG.find((entry) => entry.id === id);
    if (!cap) continue;
    for (const candidate of available) {
      if (candidate.connector === cap.connector && candidate.kind === 'read') {
        expanded.add(candidate.id);
      }
    }
  }
  return expanded;
}

/** Interview: connected caps referenced by draft + trigger + same-connector reads. */
export function relevantCapabilitiesForInterview(
  draft: InterviewDraft,
  connectedConnectors: string[],
): ConnectorCapability[] {
  const available = availableCapabilities(connectedConnectors);
  const isBlankDraft = draft.nodes.length === 0 && draft.triggerType === 'manual';

  if (isBlankDraft) {
    return available.filter(
      (cap) => cap.kind === 'trigger' || cap.kind === 'write' || isConnectorAlwaysOn(cap.connector),
    );
  }

  const referenced = expandWithConnectorReads(collectDraftCapabilityIds(draft), available);
  return available.filter((cap) => referenced.has(cap.id));
}

/** Investigate: read caps from connected connectors only. */
export function relevantCapabilitiesForInvestigate(connectedConnectors: string[]): ConnectorCapability[] {
  return availableCapabilities(connectedConnectors).filter((cap) => cap.kind === 'read');
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
      return `- ${cap.id}: ${cap.description} (connector=${cap.connector}, action=${capabilityActionName(cap)}${risk}${req})`;
    })
    .join('\n');
}

export function capabilityActionName(cap: ConnectorCapability): string {
  return cap.id.slice(cap.connector.length + 1);
}

export function paramSlotId(cap: ConnectorCapability, paramName: string): string {
  return `${cap.id}.${paramName}`;
}
