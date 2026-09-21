import type { gmail_v1 } from 'googleapis';
import type {
  GmailNewMessagePollParams,
  GmailNewMessagePollResult,
} from './contracts.js';
import { collectHistoryMessageIds } from './history.js';
import { messageEvent } from './message.js';
import { isNotFoundError, trimSeenIds } from './shared.js';

// Gmail history can surface many message ids. Keep all ids, but overlap detail
// reads in small batches so provider rate limits do not turn N+1 into a burst.
const MESSAGE_DETAIL_BATCH_SIZE = 8;

async function collectMessageEvents(
  gmail: gmail_v1.Gmail,
  messageIds: readonly string[],
  signal?: AbortSignal,
): Promise<NonNullable<Awaited<ReturnType<typeof messageEvent>>>[]> {
  const events: NonNullable<Awaited<ReturnType<typeof messageEvent>>>[] = [];
  for (let offset = 0; offset < messageIds.length; offset += MESSAGE_DETAIL_BATCH_SIZE) {
    signal?.throwIfAborted();
    const batch = await Promise.all(
      messageIds.slice(offset, offset + MESSAGE_DETAIL_BATCH_SIZE)
        .map((messageId) => messageEvent(gmail, messageId, signal)),
    );
    for (const event of batch) {
      if (event) events.push(event);
    }
  }
  return events;
}

export async function pollGmailNewMessages(
  gmail: gmail_v1.Gmail,
  params: GmailNewMessagePollParams,
  signal?: AbortSignal,
): Promise<GmailNewMessagePollResult> {
  signal?.throwIfAborted();
  const seenIds = new Set(params.seenMessageIds);

  if (!params.initialized) {
    signal?.throwIfAborted();
    const [profile, list] = await Promise.all([
      gmail.users.getProfile({ userId: 'me' }),
      gmail.users.messages.list({ userId: 'me', labelIds: ['INBOX'], maxResults: 30 }),
    ]);
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
    const events = await collectMessageEvents(gmail, messageIds, signal);

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
