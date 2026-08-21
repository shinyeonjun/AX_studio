import { resolveActionDefinition, validateActionParams } from '../../workflow/action-definition.js';
import type { InterviewDraft, WorkflowNode } from '../draft/schema.js';
import { getNodeParams, normalizeDraftActions, resolveNodeConnectorAction } from '../draft/actions.js';
import { isActionParamFilled } from './filled.js';

function nodeActionDefinition(draft: InterviewDraft, node: WorkflowNode) {
  if (node.type !== 'action') return undefined;
  const resolved = resolveNodeConnectorAction(draft, node);
  if (resolved) return resolveActionDefinition(resolved.actionRef);
  if (node.actionRef) return resolveActionDefinition(node.actionRef);
  return undefined;
}

export function ensureRequiredParamKeysOnDraft(draft: InterviewDraft): InterviewDraft {
  const normalized = normalizeDraftActions(draft);
  const actions = { ...(normalized.actions ?? {}) };
  let changed = false;

  for (const node of normalized.nodes) {
    if (node.type !== 'action') continue;
    const definition = nodeActionDefinition(normalized, node);
    if (!definition) continue;

    const params = { ...getNodeParams(normalized, node) };
    let nodeChanged = false;

    for (const name of validateActionParams(definition, params)) {
      if (isActionParamFilled(params[name])) continue;
      params[name] = '';
      nodeChanged = true;
    }

    if (!nodeChanged) continue;

    const resolved = resolveNodeConnectorAction(normalized, node);
    actions[node.id] = {
      actionRef: resolved?.actionRef ?? actions[node.id]?.actionRef ?? '',
      connector: resolved?.connector ?? actions[node.id]?.connector,
      action: resolved?.action ?? actions[node.id]?.action,
      params,
      bindings: actions[node.id]?.bindings,
    };
    changed = true;
  }

  return changed ? { ...normalized, actions } : normalized;
}
