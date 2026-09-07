import type { gmail_v1 } from 'googleapis';
import { nextGmailPage } from './pagination.js';

export async function searchGmailMessages(
  gmail: gmail_v1.Gmail,
  query: string,
  limit = 10,
  signal?: AbortSignal,
): Promise<gmail_v1.Schema$Message[]> {
  const boundedLimit = Math.min(50, Math.max(1, Number.isFinite(limit) ? Math.trunc(limit) : 10));
  const messages: gmail_v1.Schema$Message[] = [];
  const seenIds = new Set<string>();
  const seenPages = new Set<string>();
  let pageToken: string | undefined;
  do {
    signal?.throwIfAborted();
    const response = await gmail.users.messages.list({ userId: 'me', q: query, maxResults: boundedLimit, pageToken });
    signal?.throwIfAborted();
    for (const message of response.data.messages ?? []) {
      if (!message.id || seenIds.has(message.id)) continue;
      seenIds.add(message.id);
      messages.push(message);
      if (messages.length >= boundedLimit) return messages;
    }
    pageToken = nextGmailPage(seenPages, response.data.nextPageToken);
  } while (pageToken);
  return messages;
}
