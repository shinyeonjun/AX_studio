import type { gmail_v1 } from '@googleapis/gmail';
import { nextGmailPage } from '../pagination.js';

/** New messages one poll hands over; a larger backlog continues on the next poll. */
export const GMAIL_POLL_BATCH = 500;
/** History pages one poll reads; past this the poll stops at the last entry it finished. */
const MAX_HISTORY_PAGES = 20;

/**
 * New message ids since `historyId`, oldest history first. A backlog larger than one batch is not
 * an error: the poll stops at the last history entry it fully handled and returns that entry's id,
 * so the next poll continues from there instead of failing on the same backlog forever.
 */
export async function collectHistoryMessageIds(
  gmail: gmail_v1.Gmail,
  historyId: string,
  seenIds: Set<string>,
  signal?: AbortSignal,
): Promise<{ messageIds: string[]; nextHistoryId: string }> {
  let pageToken: string | undefined;
  let nextHistoryId = historyId;
  let lastHandledEntryId: string | undefined;
  const messageIds: string[] = [];
  const collectedIds = new Set<string>();
  const seenPageTokens = new Set<string>();
  let pages = 0;

  do {
    signal?.throwIfAborted();
    const historyRes = await gmail.users.history.list({
      userId: 'me',
      startHistoryId: historyId,
      historyTypes: ['messageAdded'],
      pageToken,
    });
    signal?.throwIfAborted();
    pages += 1;
    for (const entry of historyRes.data.history ?? []) {
      const fresh = (entry.messagesAdded ?? [])
        .map((added) => added.message?.id)
        .filter((id): id is string => Boolean(id) && !seenIds.has(id!) && !collectedIds.has(id!));
      if (messageIds.length > 0 && messageIds.length + fresh.length > GMAIL_POLL_BATCH && lastHandledEntryId) {
        return { messageIds, nextHistoryId: lastHandledEntryId };
      }
      // One history entry larger than a whole batch (not seen in practice) is capped, not fatal.
      for (const id of fresh.slice(0, GMAIL_POLL_BATCH - messageIds.length)) {
        collectedIds.add(id);
        messageIds.push(id);
      }
      if (entry.id) lastHandledEntryId = entry.id;
    }
    if (historyRes.data.nextPageToken && pages >= MAX_HISTORY_PAGES && lastHandledEntryId) {
      return { messageIds, nextHistoryId: lastHandledEntryId };
    }
    nextHistoryId = historyRes.data.historyId ?? nextHistoryId;
    pageToken = nextGmailPage(seenPageTokens, historyRes.data.nextPageToken);
  } while (pageToken);

  return { messageIds, nextHistoryId };
}
