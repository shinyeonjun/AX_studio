import type { WebClient } from '@slack/web-api';
import { takeUnseenSlackCursor } from './pagination.js';

export async function resolveSlackChannelId(client: WebClient, channel: string): Promise<string | undefined> {
  if (/^[CGD][A-Z0-9]+$/i.test(channel)) {
    return channel;
  }

  const name = channel.startsWith('#') ? channel.slice(1) : channel;
  let cursor: string | undefined;
  const seenCursors = new Set<string>();

  do {
    const response = await client.conversations.list({
      types: 'public_channel,private_channel',
      limit: 200,
      cursor,
    });
    const found = response.channels?.find((entry) => entry.name === name);
    if (found?.id) return found.id;
    cursor = takeUnseenSlackCursor(seenCursors, response.response_metadata?.next_cursor);
  } while (cursor);

  return undefined;
}
