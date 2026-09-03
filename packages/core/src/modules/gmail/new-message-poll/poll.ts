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
): Promise<GmailNewMessagePollResult> {
  const seenIds = new Set(params.seenMessageIds);

  if (!params.initialized) {
    const profile = await gmail.users.getProfile({ userId: 'me' });
    const list = await gmail.users.messages.list({ userId: 'me', labelIds: ['INBOX'], maxResults: 30 });
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
    const { messageIds, nextHistoryId } = await collectHistoryMessageIds(gmail, params.historyId, seenIds);
    const events = [] as GmailNewMessagePollResult['events'];
    for (const messageId of messageIds) {
      const event = await messageEvent(gmail, messageId);
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
    if (isNotFoundError(err)) {
      const profile = await gmail.users.getProfile({ userId: 'me' });
      const list = await gmail.users.messages.list({ userId: 'me', labelIds: ['INBOX'], maxResults: 30 });
      const seenMessageIds = trimSeenIds(
        (list.data.messages ?? []).map((message) => message.id).filter((id): id is string => Boolean(id)),
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
    throw err;
  }
}
