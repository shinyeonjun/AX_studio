import { resolveActionDefinition, validateActionParams } from '../../workflow/action-definition.js';
import { isDocumentIngestSourceConfigured } from '../../workflow/ingest-source.js';
import { normalizeLocalFolderDraft } from '../draft/local-folder.js';
import { InterviewDraftSchema, type InterviewDraft, type WorkflowNode } from '../draft/schema.js';
import type { ConnectedResourcesSnapshot } from '../resources/connected-resources.js';
import { getNodeBindings, getNodeParams, normalizeDraftActions, resolveNodeConnectorAction } from '../draft/actions.js';
import { isActionParamFilled } from './filled.js';

type AiDecisionWorkflowNode = WorkflowNode & { type: 'ai_decision' };

function classificationMemoFromFields(node: AiDecisionWorkflowNode): string | undefined {
  const enums = (node.outputFields ?? [])
    .flatMap((field) => field.enumValues ?? [])
    .map((value) => value.trim())
    .filter(Boolean);
  if (enums.length === 0) return undefined;
  return `${enums.join(', ')} 중 하나로 분류합니다.`;
}

/** Copy workflow goal into empty ai_decision nodes so chat does not re-ask the user's intent. */
export function seedNodeIntentFromWorkflowGoal(draft: InterviewDraft): InterviewDraft {
  const workflowGoal = draft.goal?.trim();
  if (!workflowGoal) return draft;

  let changed = false;
  const nodes = draft.nodes.map((node) => {
    if (node.type !== 'ai_decision') return node;

    const next: AiDecisionWorkflowNode = { ...node, type: 'ai_decision' };
    if (!next.goal?.trim()) {
      next.goal = workflowGoal;
      changed = true;
    }
    if (!next.memo?.trim()) {
      const memo = classificationMemoFromFields(next);
      if (memo) {
        next.memo = memo;
        changed = true;
      }
    }
    return next;
  });

  return changed ? { ...draft, nodes } : draft;
}

function hasNotifyActions(draft: InterviewDraft): boolean {
  return draft.nodes.some((node) => {
    if (node.type !== 'action') return false;
    const ref = node.actionRef ?? '';
    if (/slack\.message\.send|gmail\.message\.send/i.test(ref)) return true;
    return (
      (node.connector === 'slack' && /send/.test(node.action ?? '')) ||
      (node.connector === 'gmail' && /send/.test(node.action ?? ''))
    );
  });
}

/** Avoid asking users for an explicit completion sentence on typical notify workflows. */
export function seedDefaultSuccessCondition(draft: InterviewDraft): InterviewDraft {
  if (draft.success?.trim() || draft.nodes.length === 0) return draft;
  return {
    ...draft,
    success: hasNotifyActions(draft) ? '모든 알림 단계가 실행되면 완료' : '모든 단계가 정상 실행되면 완료',
  };
}

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
    const bindings = getNodeBindings(normalized, node);
    let nodeChanged = false;

    for (const name of validateActionParams(definition, params)) {
      if (name === 'path' && isDocumentIngestSourceConfigured(params, bindings)) continue;
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

export function finalizeInterviewDraft(
  draft: InterviewDraft,
  resources?: ConnectedResourcesSnapshot,
): InterviewDraft {
  return ensureRequiredParamKeysOnDraft(
    seedDefaultSuccessCondition(
      seedNodeIntentFromWorkflowGoal(
        InterviewDraftSchema.parse(normalizeLocalFolderDraft(draft, resources)),
      ),
    ),
  );
}
