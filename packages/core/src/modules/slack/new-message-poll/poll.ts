import type { WebClient } from '@slack/web-api';
import { resolveSlackChannelId } from '../channel-resolve.js';
import type {
  SlackNewMessagePollParams,
  SlackNewMessagePollResult,
} from './contracts.js';
import { collectSlackHistory } from './history.js';
import { toSlackNewMessageEvent } from './message.js';

export async function pollSlackNewMessages(
  client: WebClient,
  params: SlackNewMessagePollParams,
): Promise<SlackNewMessagePollResult> {
  const cachedChannelMatches = !params.initialized || params.cursorChannel === params.channel;
  let channelId = cachedChannelMatches ? params.channelId : undefined;
  let channelChanged = Boolean(params.channelId && !cachedChannelMatches);

  if (!channelId) {
    channelId = await resolveSlackChannelId(client, params.channel);
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
  const messages = await collectSlackHistory(
    client,
    channelId,
    initialized ? params.lastMessageTs ?? '0' : undefined,
  );

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
  const events = newMessages.map((message) =>
    toSlackNewMessageEvent(message, params.channel, channelId),
  );
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
