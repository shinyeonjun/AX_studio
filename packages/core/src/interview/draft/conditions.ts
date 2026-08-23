import type { ConditionExpr } from '../../runtime/condition-expr.js';
import { tryNormalizeCondition } from '../../runtime/condition-expr.js';
import type { InterviewDraft, WorkflowNode } from './schema.js';

const IF_ROLE_ALIASES: Record<string, string[]> = {
  urgent: ['긴급', 'urgent', 'critical'],
  critical: ['긴급', 'critical', 'urgent'],
  ops: ['운영', 'operational', 'high'],
  operational: ['운영', 'operational'],
  high: ['운영', 'high'],
  normal: ['일반', 'normal', 'general', '보고'],
  general: ['일반', 'general', '보고'],
  report: ['보고', 'normal', 'general'],
};

function findClassificationField(draft: InterviewDraft): { fieldRef: string; enums: string[] } | undefined {
  for (const node of draft.nodes) {
    if (node.type !== 'ai_decision') continue;
    for (const field of node.outputFields ?? []) {
      const enums = (field.enumValues ?? []).map((value) => value.trim()).filter(Boolean);
      if (enums.length >= 2) {
        return { fieldRef: `${node.id}.${field.name}`, enums };
      }
    }
  }
  return undefined;
}

function inferIfCondition(ifId: string, fieldRef: string, enums: string[]): ConditionExpr | undefined {
  const tokens = ifId.toLowerCase().split(/[_\-.]+/).filter(Boolean);
  for (const token of tokens) {
    const direct = enums.find((value) => value.toLowerCase() === token);
    if (direct) {
      return { op: 'eq', left: { ref: fieldRef }, right: { lit: direct } };
    }
    const aliases = IF_ROLE_ALIASES[token];
    if (!aliases) continue;
    const match = enums.find((value) =>
      aliases.some((alias) => alias.toLowerCase() === value.toLowerCase()),
    );
    if (match) {
      return { op: 'eq', left: { ref: fieldRef }, right: { lit: match } };
    }
  }
  return undefined;
}

/** Infer missing if conditions from ai_decision enum fields and if node ids like `if_urgent`. */
export function seedIfConditionsFromClassification(draft: InterviewDraft): InterviewDraft {
  const classification = findClassificationField(draft);
  if (!classification) return draft;

  let changed = false;
  const nodes = draft.nodes.map((node) => {
    if (node.type !== 'if' || resolveIfNodeCondition(node)) return node;
    const condition = inferIfCondition(node.id, classification.fieldRef, classification.enums);
    if (!condition) return node;
    changed = true;
    return { ...node, condition };
  });

  return changed ? { ...draft, nodes } : draft;
}

export function resolveIfNodeCondition(node: WorkflowNode): ConditionExpr | undefined {
  if (node.type !== 'if' || node.condition == null) return undefined;
  return tryNormalizeCondition(node.condition);
}

export function normalizeDraftIfConditions(draft: InterviewDraft): InterviewDraft {
  const seeded = seedIfConditionsFromClassification(draft);
  const nodes = seeded.nodes.map((node) => {
    if (node.type !== 'if') return node;
    const condition = resolveIfNodeCondition(node);
    if (!condition) return node;
    return { ...node, condition };
  });
  return { ...seeded, nodes };
}
