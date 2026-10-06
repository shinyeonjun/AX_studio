import { actionRefFor, resolveActionDefinition } from '../../action-definition.js';
import { capabilityActionName, resolveCapability } from '../../../catalog/capability-graph.js';
import type { ActionInstance, WorkflowCanvasDraftInput, WorkflowNode } from './schema.js';

function getActionInstance(draft: WorkflowCanvasDraftInput, nodeId: string): ActionInstance | undefined {
  return draft.actions?.[nodeId] as ActionInstance | undefined;
}

function resolveNodeActionRef(node: WorkflowNode, instance?: ActionInstance): string | undefined {
  if (node.type !== 'action') return undefined;
  if (instance?.actionRef?.trim()) return instance.actionRef.trim();
  if (node.actionRef?.trim()) return node.actionRef.trim();
  if (node.connector?.trim() && node.action?.trim()) {
    const cap = resolveCapability(node.connector, node.action);
    return cap ? actionRefFor(cap.connector, capabilityActionName(cap)) : undefined;
  }
  return undefined;
}

export function resolveNodeConnectorAction(
  draft: WorkflowCanvasDraftInput,
  node: WorkflowNode,
): { connector: string; action: string; actionRef: string } | undefined {
  if (node.type !== 'action') return undefined;
  const instance = getActionInstance(draft, node.id);
  const actionRef = resolveNodeActionRef(node, instance);
  if (actionRef) {
    const definition = resolveActionDefinition(actionRef);
    if (definition) return { connector: definition.connector, action: definition.action, actionRef };
  }
  if (node.connector?.trim() && node.action?.trim()) {
    const cap = resolveCapability(node.connector, node.action);
    if (!cap) return undefined;
    return {
      connector: cap.connector,
      action: capabilityActionName(cap),
      actionRef: actionRefFor(cap.connector, capabilityActionName(cap)),
    };
  }
  return undefined;
}

export function getNodeParams(draft: WorkflowCanvasDraftInput, node: WorkflowNode): Record<string, unknown> {
  if (node.type !== 'action') return {};
  return getActionInstance(draft, node.id)?.params ?? {};
}
