import { safeFormatCondition, type ConditionExpr } from '../../../runtime/condition-expr.js';
import type { WorkflowNode } from '../../canvas/draft/schema.js';
import { truncate } from '../helpers.js';
import type { NodeDisplayResult } from '../types.js';

function conditionText(condition: ConditionExpr | undefined): string {
  if (!condition) return '조건: ?';
  return safeFormatCondition(condition);
}

export function displayIfNode(node: WorkflowNode): NodeDisplayResult {
  const condition = conditionText(node.condition);
  return {
    kind: 'if',
    label: 'IF',
    conditionLabel: condition,
    lines: [{ text: condition, complete: Boolean(node.condition) }],
    tooltip: condition,
    card: {
      header: 'Flow',
      brand: 'IF',
      brandStyle: 'bracket',
      summary: truncate(condition, 26),
    },
    incomplete: !node.condition,
  };
}

export function displayApprovalNode(
  node: WorkflowNode,
): NodeDisplayResult {
  const reason = node.reason?.trim() ?? '';
  const summary = reason ? truncate(reason, 24) : '승인 필요';
  return {
    kind: 'human_approval',
    label: '승인',
    subtitle: reason || undefined,
    lines: [],
    tooltip: reason || summary,
    card: {
      header: 'Flow',
      brand: 'Approval',
      brandStyle: 'bracket',
      summary,
    },
    incomplete: !reason,
  };
}
