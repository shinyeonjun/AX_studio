import type { WorkflowNode } from '../../canvas/draft/schema.js';
import { truncate } from '../helpers.js';
import type { NodeDisplayResult } from '../types.js';

export function displayAiDecisionNode(node: WorkflowNode): NodeDisplayResult {
  const goal = node.goal?.trim() ?? '';
  const memo = node.memo?.trim();
  const summary = goal ? truncate(goal, 24) : '목표 미설정';
  const lines = node.outputFields?.length
    ? node.outputFields
        .slice(0, 2)
        .map((field) => ({ text: field.description || field.name, complete: true }))
    : [{ text: '결과 형식', complete: Boolean(node.outputFields?.length) }];
  if (memo) {
    lines.unshift({ text: truncate(memo, 28), complete: true });
  }
  return {
    kind: 'ai_decision',
    label: 'AI',
    subtitle: goal || memo || undefined,
    lines,
    tooltip: memo ? `${goal || summary} · ${truncate(memo, 40)}` : goal || summary,
    card: {
      header: 'AI',
      brand: 'AI',
      brandStyle: 'ai',
      summary,
    },
    incomplete: !goal,
  };
}
