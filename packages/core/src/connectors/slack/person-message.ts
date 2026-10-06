/**
 * Subtypes that are still someone's message with text: text posted with a file, and a thread
 * reply also sent to the channel. Other subtypes (joins, edits, deletions, channel events) are not.
 */
const MESSAGE_SUBTYPES_WITH_TEXT = new Set(['file_share', 'thread_broadcast']);

export function isMessageWithText(message: { type?: unknown; subtype?: unknown }): boolean {
  if (message.type !== 'message') return false;
  return !message.subtype || (typeof message.subtype === 'string' && MESSAGE_SUBTYPES_WITH_TEXT.has(message.subtype));
}
