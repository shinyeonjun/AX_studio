import type { gmail_v1 } from 'googleapis';
import { nextGmailPage } from '../pagination.js';

export async function collectHistoryMessageIds(
  gmail: gmail_v1.Gmail,
  historyId: string,
  seenIds: Set<string>,
  signal?: AbortSignal,
): Promise<{ messageIds: string[]; nextHistoryId: string }> {
  let pageToken: string | undefined;
  let nextHistoryId = historyId;
  const messageIds: string[] = [];
  const collectedIds = new Set<string>();
  const seenPageTokens = new Set<string>();

  do {
    signal?.throwIfAborted();
    const historyRes = await gmail.users.history.list({
      userId: 'me',
      startHistoryId: historyId,
      historyTypes: ['messageAdded'],
      pageToken,
    });
    signal?.throwIfAborted();
    nextHistoryId = historyRes.data.historyId ?? nextHistoryId;
    for (const entry of historyRes.data.history ?? []) {
      for (const added of entry.messagesAdded ?? []) {
        const id = added.message?.id;
        if (id && !seenIds.has(id) && !collectedIds.has(id)) {
          if (messageIds.length >= 500) throw new Error('message_limit');
          collectedIds.add(id);
          messageIds.push(id);
        }
      }
    }
    pageToken = nextGmailPage(seenPageTokens, historyRes.data.nextPageToken);
  } while (pageToken);

  return { messageIds, nextHistoryId };
}
