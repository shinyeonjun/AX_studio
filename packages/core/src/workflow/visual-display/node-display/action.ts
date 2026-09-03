import { getConnectorLabel } from '../../../catalog/connectors.js';
import { resolveCapability } from '../../../catalog/capability-graph.js';
import type { CompletenessResult } from '../../canvas/slots/requiredness.js';
import type { WorkflowCanvasDraft, WorkflowNode } from '../../canvas/draft/schema.js';
import { getNodeParams, resolveNodeConnectorAction } from '../../canvas/draft/actions.js';
import {
  paramLine,
  paramValue,
  primaryParamValue,
  summaryFromGoalOrCapability,
  truncate,
} from '../helpers.js';
import type { NodeDisplayResult, WorkflowCardDisplay } from '../types.js';

function actionLines(
  draft: WorkflowCanvasDraft,
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

function actionCard(draft: WorkflowCanvasDraft, node: WorkflowNode): WorkflowCardDisplay {
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

export function displayActionNode(
  draft: WorkflowCanvasDraft,
  node: WorkflowNode,
  slots?: CompletenessResult['slots'],
): NodeDisplayResult {
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
