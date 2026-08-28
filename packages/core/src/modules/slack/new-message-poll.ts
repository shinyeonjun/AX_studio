import type { WebClient } from '@slack/web-api';
import { resolveSlackChannelId } from './channel-resolve.js';
import { takeUnseenSlackCursor } from './pagination.js';

export interface SlackNewMessagePollParams {
  channel: string;
  initialized: boolean;
  lastMessageTs?: string;
  cursorChannel?: string;
  channelId?: string;
}

export interface SlackNewMessageEvent {
  type: 'slack.new_message';
  payload: {
    messageId: string;
    ts: string;
    channel: string;
    channelId: string;
    text: string;
    user?: string;
    sender?: string;
  };
}

export interface SlackNewMessagePollResult {
  events: SlackNewMessageEvent[];
  cursor: {
    initialized: boolean;
    channel: string;
    channelId?: string;
    lastMessageTs?: string;
  };
}

async function resolveChannelId(client: WebClient, channel: string): Promise<string | undefined> {
  return resolveSlackChannelId(client, channel);
}

function isUserMessage(message: { type?: string; subtype?: string; ts?: string; text?: string; user?: string }) {
  return message.type === 'message' && !message.subtype && Boolean(message.ts);
}

export async function pollSlackNewMessages(
  client: WebClient,
  params: SlackNewMessagePollParams,
): Promise<SlackNewMessagePollResult> {
  const cachedChannelMatches = !params.initialized || params.cursorChannel === params.channel;
  let channelId = cachedChannelMatches ? params.channelId : undefined;
  let channelChanged = Boolean(params.channelId && !cachedChannelMatches);

  if (!channelId) {
    channelId = await resolveChannelId(client, params.channel);
    if (channelId && params.channelId) {
      channelChanged = channelId !== params.channelId;
    }
  }

  if (!channelId) {
    return {
      events: [],
      cursor: {
        initialized: channelChanged ? false : params.initialized,
        channel: params.channel,
        lastMessageTs: channelChanged ? undefined : params.lastMessageTs,
      },
    };
  }

  const initialized = params.initialized && !channelChanged;

  const messages: NonNullable<Awaited<ReturnType<WebClient['conversations']['history']>>['messages']> = [];
  const seenMessageTimestamps = new Set<string>();
  let cursor: string | undefined;
  const seenCursors = new Set<string>();
  do {
    const history = await client.conversations.history({
      channel: channelId,
      limit: 100,
      cursor,
      oldest: initialized ? params.lastMessageTs ?? '0' : undefined,
    });
    for (const message of (history.messages ?? []).filter(isUserMessage)) {
      if (seenMessageTimestamps.has(message.ts!)) continue;
      seenMessageTimestamps.add(message.ts!);
      messages.push(message);
    }
    cursor = takeUnseenSlackCursor(seenCursors, history.response_metadata?.next_cursor);
  } while (initialized && cursor);

  if (!initialized) {
    return {
      events: [],
      cursor: {
        initialized: true,
        channel: params.channel,
        channelId,
        lastMessageTs: messages[0]?.ts ?? '0',
      },
    };
  }

  const lastTs = params.lastMessageTs ?? '0';
  const newMessages = messages
    .filter((message) => message.ts && message.ts > lastTs)
    .sort((a, b) => (a.ts! < b.ts! ? -1 : 1));

  const events: SlackNewMessageEvent[] = newMessages.map((message) => ({
    type: 'slack.new_message',
    payload: {
      messageId: message.ts!,
      ts: message.ts!,
      channel: params.channel,
      channelId,
      text: message.text ?? '',
      user: message.user,
      sender: message.user,
    },
  }));

  const latestTs =
    newMessages.length > 0 ? newMessages[newMessages.length - 1]?.ts ?? lastTs : lastTs;

  return {
    events,
    cursor: {
      initialized: true,
      channel: params.channel,
      channelId,
      lastMessageTs: latestTs,
    },
  };
}
