import type { WebClient } from '@slack/web-api';
import { takeUnseenSlackCursor } from './pagination.js';
import { slackRequest } from './request.js';

export async function resolveSlackChannelId(client: WebClient, channel: string, signal?: AbortSignal): Promise<string | undefined> {
  signal?.throwIfAborted();
  if (/^[CGD][A-Z0-9]+$/.test(channel)) {
    return channel;
  }

  const name = channel.startsWith('#') ? channel.slice(1) : channel;
  let cursor: string | undefined;
  const seenCursors = new Set<string>();

  do {
    const response = await slackRequest(() => client.conversations.list({
      types: 'public_channel,private_channel',
      limit: 200,
      cursor,
    }), signal);
    const found = response.channels?.find((entry) => entry.name === name);
    if (found?.id) return found.id;
    cursor = takeUnseenSlackCursor(seenCursors, response.response_metadata?.next_cursor);
  } while (cursor);

  return undefined;
}
