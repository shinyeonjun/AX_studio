import type { InterviewDraft } from '../draft/schema.js';
import { preprocessConditionValue } from '../../runtime/condition-expr.js';
import { normalizeDraftActions, setNodeParam } from '../draft/actions.js';
import { parseNodeMemoSlot, parseNodeParamSlot, parseNodeTextSlot } from './ids.js';

const TRIGGER_TYPE_VALUES = [
  'manual',
  'once',
  'schedule',
  'gmail.new_message',
  'slack.new_message',
  'local_folder.new_file',
] as const satisfies readonly NonNullable<InterviewDraft['triggerType']>[];

function parseTriggerType(value: unknown): InterviewDraft['triggerType'] | undefined {
  const text = typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
  if (!text) return undefined;
  return TRIGGER_TYPE_VALUES.find((entry) => entry === text);
}

const TRIGGER_SLOT_MAP: Record<string, keyof InterviewDraft> = {
  'gmail.new_message.accountId': 'gmailAccount',
  'slack.new_message.channel': 'slackChannel',
  'local_folder.new_file.folderId': 'localFolderId',
  'local_folder.new_file.folderPath': 'localFolderPath',
  'local_folder.new_file.extensions': 'localFolderExtensions',
};

function applyScalarToDraft(draft: InterviewDraft, slot: string, value: unknown): void {
  if (value == null) return;
  const text = typeof value === 'string' ? value.trim() : String(value);

  switch (slot) {
    case 'goal':
      draft.goal = text;
      return;
    case 'trigger.schedule':
      draft.schedule = text;
      return;
    case 'trigger.timezone':
      draft.timezone = text;
      return;
    case 'trigger.runAt':
      draft.runAt = text;
      return;
    case 'trigger':
    case 'triggerType': {
      const triggerType = parseTriggerType(value);
      if (triggerType) draft.triggerType = triggerType;
      return;
    }
    case 'trigger.filter': {
      const normalized = preprocessConditionValue(value);
      if (normalized) draft.triggerFilter = normalized;
      return;
    }
    case 'completion':
      draft.success = text;
      return;
    default: {
      const triggerField = TRIGGER_SLOT_MAP[slot];
      if (triggerField) {
        (draft as Record<string, unknown>)[triggerField] = text;
      }
    }
  }
}

function applyNodeMemoSlot(draft: InterviewDraft, slot: string, value: unknown): boolean {
  const parsed = parseNodeMemoSlot(slot);
  if (!parsed) return false;

  const node = draft.nodes.find((entry) => entry.id === parsed.nodeId);
  if (!node || node.type !== 'ai_decision') return false;

  const text = typeof value === 'string' ? value.trim() : value == null ? '' : String(value);
  node.memo = text || undefined;
  return true;
}

function applyNodeParamSlot(draft: InterviewDraft, slot: string, value: unknown): boolean {
  const parsed = parseNodeParamSlot(slot);
  if (!parsed) return false;

  const node = draft.nodes.find((entry) => entry.id === parsed.nodeId);
  if (!node || node.type !== 'action') return false;

  Object.assign(draft, setNodeParam(draft, parsed.nodeId, parsed.paramName, value));
  return true;
}

function applyNodeTextSlot(draft: InterviewDraft, slot: string, value: unknown): boolean {
  const parsed = parseNodeTextSlot(slot);
  if (!parsed) return false;

  const node = draft.nodes.find((entry) => entry.id === parsed.nodeId);
  if (!node || (node.type !== 'ai_decision' && node.type !== 'human_approval')) return false;

  const text = typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
  if (parsed.field === 'goal' && node.type === 'ai_decision') node.goal = text || undefined;
  if (parsed.field === 'reason' && node.type === 'human_approval') node.reason = text || undefined;
  return true;
}

export function applySlotValuesToDraft(
  draft: InterviewDraft,
  slotValues: Record<string, unknown>,
): InterviewDraft {
  const normalized = normalizeDraftActions(draft);
  let next: InterviewDraft = {
    ...normalized,
    actions: { ...(normalized.actions ?? {}) },
    nodes: normalized.nodes.map((node) => ({ ...node })),
  };

  for (const [slot, value] of Object.entries(slotValues)) {
    if (applyNodeParamSlot(next, slot, value)) continue;
    if (applyNodeMemoSlot(next, slot, value)) continue;
    if (applyNodeTextSlot(next, slot, value)) continue;
    applyScalarToDraft(next, slot, value);
  }

  return next;
}
