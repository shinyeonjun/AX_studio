import { displayForTrigger } from '../../../../workflow/visual-display/trigger-display.js';
import type { WorkflowCanvasDraft } from '../../draft/schema.js';
import type { CompletenessResult } from '../../slots/types.js';
import type { PanelField } from './types.js';

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

export function triggerPanelFields(
  draft: WorkflowCanvasDraft,
  completeness: CompletenessResult,
): PanelField[] {
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
