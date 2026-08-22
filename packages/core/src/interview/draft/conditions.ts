import type { ConditionExpr } from '../../runtime/condition-expr.js';
import { tryNormalizeCondition } from '../../runtime/condition-expr.js';
import type { InterviewDraft, WorkflowNode } from './schema.js';

export function resolveIfNodeCondition(node: WorkflowNode): ConditionExpr | undefined {
  if (node.type !== 'if' || node.condition == null) return undefined;
  return tryNormalizeCondition(node.condition);
}

export function normalizeDraftIfConditions(draft: InterviewDraft): InterviewDraft {
  const nodes = draft.nodes.map((node) => {
    if (node.type !== 'if') return node;
    const condition = resolveIfNodeCondition(node);
    if (!condition) return node;
    return { ...node, condition };
  });
  return { ...draft, nodes };
}
