import type { ConnectorCapability } from '../../catalog/capability-types.js';
import {
  availableCapabilities,
  isConnectorAlwaysOn,
} from '../../catalog/capability-graph.js';
import { CAPABILITY_CATALOG } from '../../catalog/capabilities.js';
import { resolveCapability } from '../../catalog/capability-resolver.js';
import type { InterviewDraft, WorkflowNode } from '../draft/schema.js';

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
  if (draft.triggerType) {
    const trigger = CAPABILITY_CATALOG.find((cap) => cap.id === draft.triggerType);
    if (trigger) ids.add(trigger.id);
  }
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

/** Interview-specific capability narrowing belongs to the interview resource layer. */
export function relevantCapabilitiesForInterview(
  draft: InterviewDraft,
  connectedConnectors: string[],
): ConnectorCapability[] {
  const available = availableCapabilities(connectedConnectors);
  const isBlankDraft = draft.nodes.length === 0 && (!draft.triggerType || draft.triggerType === 'manual');

  if (isBlankDraft) {
    return available.filter(
      (cap) => cap.kind === 'trigger' || cap.kind === 'write' || isConnectorAlwaysOn(cap.connector),
    );
  }

  const referenced = expandWithConnectorReads(collectDraftCapabilityIds(draft), available);
  return available.filter((cap) => referenced.has(cap.id));
}
