import { actionRefFor, resolveActionDefinition } from '../../../workflow/action-definition.js';
import { capabilityActionName, resolveCapability } from '../../../catalog/capability-graph.js';
import type { PortBinding } from '../../../workflow/bindings.js';
import type { ActionInstance, WorkflowCanvasDraft, WorkflowCanvasDraftInput, WorkflowNode } from './schema.js';

export function getActionInstance(draft: WorkflowCanvasDraftInput, nodeId: string): ActionInstance | undefined {
  return draft.actions?.[nodeId] as ActionInstance | undefined;
}

export function resolveNodeActionRef(node: WorkflowNode, instance?: ActionInstance): string | undefined {
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

export function getNodeBindings(
  draft: WorkflowCanvasDraftInput,
  node: WorkflowNode,
): Record<string, PortBinding> | undefined {
  if (node.type !== 'action') return undefined;
  return getActionInstance(draft, node.id)?.bindings ?? node.bindings;
}

export function setNodeParam(
  draft: WorkflowCanvasDraft,
  nodeId: string,
  paramName: string,
  value: unknown,
): WorkflowCanvasDraft {
  const node = draft.nodes.find((entry) => entry.id === nodeId && entry.type === 'action');
  if (!node) return draft;
  return replaceActionParams(draft, node, { ...getNodeParams(draft, node), [paramName]: value });
}

export function replaceActionParams(
  draft: WorkflowCanvasDraft,
  node: WorkflowNode,
  params: Record<string, unknown>,
): WorkflowCanvasDraft {
  if (node.type !== 'action') return draft;
  const current = getActionInstance(draft, node.id);
  const resolved = resolveNodeConnectorAction(draft, node);
  const actionRef = resolved?.actionRef ?? current?.actionRef ?? '';
  return {
    ...draft,
    actions: {
      ...(draft.actions ?? {}),
      [node.id]: {
        actionRef,
        connector: resolved?.connector ?? current?.connector,
        action: resolved?.action ?? current?.action,
        params,
        bindings: current?.bindings,
      },
    },
    nodes: draft.nodes.map((entry) => {
      if (entry.id !== node.id || entry.type !== 'action') return entry;
      const { params: _params, bindings: _bindings, connector: _connector, action: _action, ...rest } = entry;
      return { ...rest, type: 'action', actionRef: actionRef || entry.actionRef };
    }),
  };
}

export function normalizeDraftActions(draft: WorkflowCanvasDraft): WorkflowCanvasDraft {
  const actions: Record<string, ActionInstance> = { ...(draft.actions ?? {}) };
  const nodes = draft.nodes.map((node) => {
    if (node.type !== 'action') return node;
    const resolved = resolveNodeConnectorAction({ ...draft, actions }, node);
    const fallbackRef = node.connector?.trim() && node.action?.trim()
      ? actionRefFor(node.connector.trim(), node.action.trim())
      : '';
    const actionRef = resolved?.actionRef ?? actions[node.id]?.actionRef ?? fallbackRef;
    const params = { ...(actions[node.id]?.params ?? {}), ...(node.params ?? {}) };
    const bindings = actions[node.id]?.bindings ?? node.bindings;
    if (actionRef || node.connector?.trim() || node.action?.trim() || Object.keys(params).length > 0 || bindings) {
      actions[node.id] = {
        actionRef: actionRef || actions[node.id]?.actionRef || fallbackRef,
        connector: resolved?.connector ?? actions[node.id]?.connector ?? node.connector,
        action: resolved?.action ?? actions[node.id]?.action ?? node.action,
        params,
        bindings,
      };
    }
    const { params: _params, bindings: _bindings, connector: _connector, action: _action, ...rest } = node;
    return { ...rest, type: 'action' as const, actionRef: actionRef || node.actionRef };
  });
  return { ...draft, nodes, actions };
}
