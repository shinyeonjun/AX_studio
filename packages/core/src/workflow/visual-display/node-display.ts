import { getCapability } from '../../catalog/capabilities.js';
import { getConnectorLabel } from '../../catalog/connectors.js';
import { resolveCapability } from '../../catalog/capability-graph.js';
import { safeFormatCondition, type ConditionExpr } from '../../runtime/condition-expr.js';
import type { CompletenessResult } from '../../interview/slots/requiredness.js';
import type { InterviewDraft, WorkflowNode } from '../../interview/draft/schema.js';
import { getNodeParams, resolveNodeConnectorAction } from '../../interview/draft/actions.js';
import {
  paramLine,
  paramValue,
  primaryParamValue,
  summaryFromGoalOrCapability,
  truncate,
} from './helpers.js';
import type { NodeDisplayResult, WorkflowCardDisplay } from './types.js';

function actionLines(
  draft: InterviewDraft,
  node: WorkflowNode,
  slots: CompletenessResult['slots'] | undefined,
) {
  const resolved = resolveNodeConnectorAction(draft, node);
  if (!resolved) return [{ text: '설정 필요', complete: false }];
  const cap = resolveCapability(resolved.connector, resolved.action);
  if (!cap) return [{ text: '연결 확인 필요', complete: false }];

  const params = getNodeParams(draft, node);
  const lines = [];
  for (const param of cap.params) {
    lines.push(paramLine(cap.id, param.name, param.label, paramValue(params, param.name), slots));
  }
  if (lines.length === 0 && node.goal?.trim()) {
    lines.push({ text: node.goal.trim(), complete: true });
  }
  return lines.slice(0, 3);
}

function actionCard(draft: InterviewDraft, node: WorkflowNode): WorkflowCardDisplay {
  const resolved = resolveNodeConnectorAction(draft, node);
  const cap = resolved ? resolveCapability(resolved.connector, resolved.action) : undefined;
  const params = getNodeParams(draft, node);
  const summary = summaryFromGoalOrCapability(node.goal, cap, params, 24);
  const primary = cap ? primaryParamValue(cap, params) : undefined;
  const captionSub =
    primary && primary !== summary && !node.goal?.trim()
      ? truncate(primary, 32)
      : cap && primary && node.goal?.trim()
        ? truncate(primary, 32)
        : undefined;

  return {
    header: 'Action',
    brand: getConnectorLabel(resolved?.connector ?? 'action'),
    brandStyle: 'bracket',
    summary,
    captionSub,
  };
}

function conditionText(condition: ConditionExpr | undefined): string {
  if (!condition) return '조건: ?';
  return safeFormatCondition(condition);
}

export function displayForWorkflowNode(
  draft: InterviewDraft,
  node: WorkflowNode,
  slots?: CompletenessResult['slots'],
): NodeDisplayResult {
  switch (node.type) {
    case 'action': {
      const resolved = resolveNodeConnectorAction(draft, node);
      const cap = resolved ? resolveCapability(resolved.connector, resolved.action) : undefined;
      const lines = actionLines(draft, node, slots);
      const label = cap?.label ?? getConnectorLabel(resolved?.connector ?? 'action');
      const card = actionCard(draft, node);
      if (cap?.connector === 'slack') {
        card.brandStyle = 'plain';
      }
      const detail = lines.map((line) => line.text).join(' · ');
      return {
        kind: 'action',
        label,
        subtitle: node.goal?.trim() || cap?.description,
        lines,
        iconConnector: resolved?.connector,
        tooltip: detail ? `${label} · ${detail}` : label,
        card,
        incomplete: lines.some((line) => !line.complete),
      };
    }
    case 'ai_decision': {
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
    case 'if': {
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
    case 'human_approval': {
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
    default:
      return {
        kind: 'action',
        label: '단계',
        lines: [],
        card: {
          header: 'Action',
          brand: 'Step',
          brandStyle: 'bracket',
          summary: '설정 필요',
        },
        incomplete: true,
      };
  }
}

export function displayForCapability(
  capabilityId: string,
  options?: { goal?: string; params?: Record<string, unknown> },
): WorkflowCardDisplay {
  const cap = getCapability(capabilityId);
  if (!cap) {
    return {
      header: 'Action',
      brand: capabilityId,
      brandStyle: 'bracket',
      summary: capabilityId,
    };
  }
  return {
    header: cap.kind === 'trigger' ? 'Trigger' : 'Action',
    brand: getConnectorLabel(cap.connector),
    brandStyle: cap.connector === 'slack' ? 'plain' : 'bracket',
    summary: summaryFromGoalOrCapability(options?.goal, cap, options?.params, 24),
    captionSub: primaryParamValue(cap, options?.params),
  };
}

export function editPromptForNode(draft: InterviewDraft, node: WorkflowNode): string {
  const display = displayForWorkflowNode(draft, node);
  return `${display.label} 단계를 어떻게 바꿀까요?`;
}
