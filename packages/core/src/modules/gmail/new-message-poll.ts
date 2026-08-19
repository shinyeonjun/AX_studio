import type { gmail_v1 } from 'googleapis';

export interface GmailNewMessagePollParams {
  initialized: boolean;
  seenMessageIds: string[];
  historyId?: string;
}

export interface GmailNewMessageEvent {
  type: 'gmail.new_message';
  payload: {
    messageId: string;
    from: string;
    subject: string;
    snippet: string;
    sender: string;
  };
}

export interface GmailNewMessagePollResult {
  events: GmailNewMessageEvent[];
  cursor: {
    initialized: boolean;
    seenMessageIds: string[];
    historyId?: string;
  };
}

const MAX_SEEN_MESSAGE_IDS = 500;

function trimSeenIds(ids: string[]): string[] {
  if (ids.length <= MAX_SEEN_MESSAGE_IDS) return ids;
  return ids.slice(ids.length - MAX_SEEN_MESSAGE_IDS);
}

function headerValue(headers: gmail_v1.Schema$MessagePartHeader[] | undefined, name: string): string {
  return headers?.find((header) => header.name?.toLowerCase() === name.toLowerCase())?.value ?? '';
}

async function messageEvent(
  gmail: gmail_v1.Gmail,
  messageId: string,
): Promise<GmailNewMessageEvent> {
  const res = await gmail.users.messages.get({
    userId: 'me',
    id: messageId,
    format: 'metadata',
    metadataHeaders: ['From', 'Subject'],
  });
  const from = headerValue(res.data.payload?.headers, 'From');
  const subject = headerValue(res.data.payload?.headers, 'Subject');
  const snippet = res.data.snippet ?? '';
  return {
    type: 'gmail.new_message',
    payload: {
      messageId,
      from,
      subject,
      snippet,
      sender: from,
    },
  };
}

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
    const historyRes = await gmail.users.history.list({
      userId: 'me',
      startHistoryId: params.historyId,
      historyTypes: ['messageAdded'],
    });

    const nextHistoryId = historyRes.data.historyId ?? params.historyId;
    const messageIds: string[] = [];
    for (const entry of historyRes.data.history ?? []) {
      for (const added of entry.messagesAdded ?? []) {
        const id = added.message?.id;
        if (id && !seenIds.has(id)) {
          messageIds.push(id);
        }
      }
    }

    const events: GmailNewMessageEvent[] = [];
    for (const messageId of messageIds) {
      events.push(await messageEvent(gmail, messageId));
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
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('historyId') || message.includes('404')) {
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
