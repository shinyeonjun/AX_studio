import type { gmail_v1 } from 'googleapis';

export async function collectHistoryMessageIds(
  gmail: gmail_v1.Gmail,
  historyId: string,
  seenIds: Set<string>,
): Promise<{ messageIds: string[]; nextHistoryId: string }> {
  let pageToken: string | undefined;
  let nextHistoryId = historyId;
  const messageIds: string[] = [];
  const collectedIds = new Set<string>();
  const seenPageTokens = new Set<string>();

  do {
    if (pageToken) seenPageTokens.add(pageToken);
    const historyRes = await gmail.users.history.list({
      userId: 'me',
      startHistoryId: historyId,
      historyTypes: ['messageAdded'],
      pageToken,
    });
    nextHistoryId = historyRes.data.historyId ?? nextHistoryId;
    for (const entry of historyRes.data.history ?? []) {
      for (const added of entry.messagesAdded ?? []) {
        const id = added.message?.id;
        if (id && !seenIds.has(id) && !collectedIds.has(id)) {
          collectedIds.add(id);
          messageIds.push(id);
        }
      }
    }
    const nextPageToken = historyRes.data.nextPageToken ?? undefined;
    pageToken = nextPageToken && !seenPageTokens.has(nextPageToken)
      ? nextPageToken
      : undefined;
  } while (pageToken);

  return { messageIds, nextHistoryId };
}
