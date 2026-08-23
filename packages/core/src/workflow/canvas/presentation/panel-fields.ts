import { resolveCapability } from '../../../catalog/capability-graph.js';
import { getConnectorLabel } from '../../../catalog/connectors.js';
import type { WorkflowCanvasDraft, WorkflowNode } from '../draft/schema.js';
import { getNodeParams, resolveNodeConnectorAction } from '../draft/actions.js';
import { isActionParamFilled } from '../slots/filled.js';
import {
  nodeMemoSlotId,
  nodeParamSlotId,
  parseNodeMemoSlot,
  parseNodeParamSlot,
} from '../slots/ids.js';
import type { CompletenessResult } from '../slots/types.js';
import { displayForTrigger } from '../../../workflow/visual-display/trigger-display.js';

export interface PanelField {
  slot: string;
  label: string;
  hint?: string;
  value: string;
  required: boolean;
}

const TRIGGER_DRAFT_FIELDS: Record<string, keyof WorkflowCanvasDraft> = {
  'trigger.schedule': 'schedule',
  'trigger.timezone': 'timezone',
  'trigger.runAt': 'runAt',
  'gmail.new_message.accountId': 'gmailAccount',
  'slack.new_message.channel': 'slackChannel',
  'local_folder.new_file.folderId': 'localFolderId',
  'local_folder.new_file.folderPath': 'localFolderPath',
  'local_folder.new_file.extensions': 'localFolderExtensions',
};

function formatParamValue(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'object') return JSON.stringify(value);
  return '';
}

function triggerDraftValue(draft: WorkflowCanvasDraft, slot: string): string {
  if (slot === 'triggerType') return draft.triggerType ?? '';
  const field = TRIGGER_DRAFT_FIELDS[slot];
  if (!field) return '';
  const value = draft[field];
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

function isTriggerSlot(slot: string): boolean {
  return (
    slot === 'trigger' ||
    slot === 'triggerType' ||
    slot.startsWith('trigger.') ||
    slot.startsWith('gmail.new_message') ||
    slot.startsWith('slack.new_message') ||
    slot.startsWith('local_folder.new_file')
  );
}

export function isTriggerRequirementSlot(slot: string): boolean {
  return isTriggerSlot(slot);
}

function triggerPanelFields(draft: WorkflowCanvasDraft, completeness: CompletenessResult): PanelField[] {
  const fields: PanelField[] = [
    {
      slot: 'triggerType',
      label: '시작 방식',
      value: draft.triggerType ? displayForTrigger(draft).label : '',
      required: !draft.triggerType,
    },
  ];

  for (const slot of completeness.slots) {
    if (!isTriggerSlot(slot.slot) || slot.slot === 'triggerType') continue;
    if (slot.slot === 'trigger' && !draft.triggerType) continue;

    fields.push({
      slot: slot.slot,
      label: slot.label ?? slot.slot,
      hint: slot.question,
      value: triggerDraftValue(draft, slot.slot),
      required: !slot.filled,
    });
  }

  return fields;
}

function actionPanelFields(
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

function aiDecisionPanelFields(node: WorkflowNode, completeness: CompletenessResult): PanelField[] {
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

export function panelFieldsForSource(
  draft: WorkflowCanvasDraft | undefined,
  sourceId: string,
  completeness: CompletenessResult | undefined,
): PanelField[] {
  if (!draft || !completeness) return [];
  if (sourceId === '__trigger__') return triggerPanelFields(draft, completeness);

  const node = draft.nodes.find((entry) => entry.id === sourceId);
  if (!node) return [];

  switch (node.type) {
    case 'action':
      return actionPanelFields(draft, node, completeness);
    case 'ai_decision':
      return aiDecisionPanelFields(node, completeness);
    default:
      return [];
  }
}

export function connectionGuidance(
  missingConnections: string[] | undefined,
): { message: string; connectors: string[] } | null {
  if (!missingConnections?.length) return null;
  const labels = missingConnections.map((connector) => getConnectorLabel(connector));
  return {
    connectors: [...missingConnections],
    message: `${labels.join(', ')} 연결이 필요합니다. 설정에서 연결해 주세요.`,
  };
}
