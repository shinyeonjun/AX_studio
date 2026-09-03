import { resolveCapability } from '../../../../catalog/capability-graph.js';
import type { WorkflowCanvasDraft, WorkflowNode } from '../../draft/schema.js';
import { getNodeParams, resolveNodeConnectorAction } from '../../draft/actions.js';
import { isActionParamFilled } from '../../slots/filled.js';
import {
  nodeMemoSlotId,
  nodeParamSlotId,
  parseNodeParamSlot,
} from '../../slots/ids.js';
import type { CompletenessResult } from '../../slots/types.js';
import type { PanelField } from './types.js';

function formatParamValue(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'object') return JSON.stringify(value);
  return '';
}

export function actionPanelFields(
  draft: WorkflowCanvasDraft,
  node: WorkflowNode,
  completeness: CompletenessResult,
): PanelField[] {
  const resolved = resolveNodeConnectorAction(draft, node);
  const cap = resolved ? resolveCapability(resolved.connector, resolved.action) : undefined;
  const params = getNodeParams(draft, node);
  const slots = completeness.slots.filter((slot) => {
    const param = parseNodeParamSlot(slot.slot);
    return param?.nodeId === node.id;
  });

  if (slots.length > 0) {
    return slots.map((slot) => {
      const parsed = parseNodeParamSlot(slot.slot);
      const paramName = parsed?.paramName ?? slot.slot;
      const paramDef = cap?.params.find((entry) => entry.name === paramName);
      const raw = params[paramName];
      return {
        slot: slot.slot,
        label: paramDef?.label ?? slot.label?.split(' · ').pop() ?? paramName,
        hint: paramDef?.question ?? slot.question,
        value: formatParamValue(raw),
        required: Boolean(paramDef?.required) && !slot.filled,
      };
    });
  }

  if (!cap) return [];

  return cap.params
    .filter((param) => param.required || isActionParamFilled(params[param.name]))
    .map((param) => ({
      slot: nodeParamSlotId(node.id, param.name),
      label: param.label,
      hint: param.question,
      value: formatParamValue(params[param.name]),
      required: param.required,
    }));
}

export function aiDecisionPanelFields(
  node: WorkflowNode,
  completeness: CompletenessResult,
): PanelField[] {
  const memoSlot = completeness.slots.find((slot) => slot.slot === nodeMemoSlotId(node.id));
  return [
    {
      slot: nodeMemoSlotId(node.id),
      label: '판단 기준',
      hint: memoSlot?.question ?? '이 단계에서 어떻게 나눌지 적어 주세요.',
      value: node.memo?.trim() ?? '',
      required: false,
    },
  ];
}
