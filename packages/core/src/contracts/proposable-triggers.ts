/**
 * Event triggers a recurring-job proposal can name, with the field that picks what the trigger
 * watches (which mailbox, channel or folder). Jev is offered exactly these; the proposal reader
 * fills a missing target with '' so the host asks for it. Webhook paths are not chosen here.
 */
export const PROPOSABLE_EVENT_TRIGGER_TARGETS = {
  'gmail.new_message': 'accountId',
  'slack.new_message': 'channel',
  'local_folder.new_file': 'folderId',
} as const;

export type ProposableEventTrigger = keyof typeof PROPOSABLE_EVENT_TRIGGER_TARGETS;

export function isProposableEventTrigger(type: unknown): type is ProposableEventTrigger {
  return typeof type === 'string' && Object.hasOwn(PROPOSABLE_EVENT_TRIGGER_TARGETS, type);
}
