import type { gmail_v1 } from 'googleapis';
import type {
  GmailNewMessagePollParams,
  GmailNewMessagePollResult,
} from './contracts.js';
import { collectHistoryMessageIds } from './history.js';
import { messageEvent } from './message.js';
import { isNotFoundError, trimSeenIds } from './shared.js';

export async function pollGmailNewMessages(
  gmail: gmail_v1.Gmail,
  params: GmailNewMessagePollParams,
  signal?: AbortSignal,
): Promise<GmailNewMessagePollResult> {
  signal?.throwIfAborted();
  const seenIds = new Set(params.seenMessageIds);

  if (!params.initialized) {
    const profile = await gmail.users.getProfile({ userId: 'me' });
    signal?.throwIfAborted();
    const list = await gmail.users.messages.list({ userId: 'me', labelIds: ['INBOX'], maxResults: 30 });
    signal?.throwIfAborted();
    const seenMessageIds = trimSeenIds(
      [...new Set([...(list.data.messages ?? []).map((message) => message.id).filter(Boolean) as string[], ...params.seenMessageIds])],
    );

    return {
      events: [],
      cursor: {
        initialized: true,
        historyId: profile.data.historyId ?? undefined,
        seenMessageIds,
      },
    };
  }

  if (!params.historyId) {
    const profile = await gmail.users.getProfile({ userId: 'me' });
    signal?.throwIfAborted();
    return {
      events: [],
      cursor: {
        initialized: true,
        historyId: profile.data.historyId ?? undefined,
        seenMessageIds: trimSeenIds([...seenIds]),
      },
    };
  }

  try {
    const { messageIds, nextHistoryId } = await collectHistoryMessageIds(gmail, params.historyId, seenIds, signal);
    const events = [] as GmailNewMessagePollResult['events'];
    for (const messageId of messageIds) {
      const event = await messageEvent(gmail, messageId, signal);
      if (event) events.push(event);
    }

    return {
      events,
      cursor: {
        initialized: true,
        historyId: nextHistoryId,
        seenMessageIds: trimSeenIds([...seenIds, ...messageIds]),
      },
    };
  } catch (err) {
    signal?.throwIfAborted();
    if (isNotFoundError(err)) {
      // Rebaselining here would silently discard the interval we could not read.
      throw new Error('history_expired');
    }
    throw err;
  }
}
