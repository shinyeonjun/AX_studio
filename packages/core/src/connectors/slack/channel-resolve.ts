import type { WebClient } from '@slack/web-api';
import { takeUnseenSlackCursor } from './pagination.js';
import { slackRead } from './request.js';

export async function resolveSlackChannelId(client: WebClient, channel: string, signal?: AbortSignal): Promise<string | undefined> {
  signal?.throwIfAborted();
  if (/^[CGD][A-Z0-9]+$/.test(channel)) {
    return channel;
  }

  // Slack keeps names lowercase and unique, so "#General" or a name typed in another Unicode form
  // still means the one channel.
  const name = channelNameKey(channel.trim().replace(/^#/u, ''));
  let cursor: string | undefined;
  const seenCursors = new Set<string>();

  do {
    const response = await slackRead(() => client.conversations.list({
      types: 'public_channel,private_channel',
      limit: 200,
      cursor,
    }), signal);
    const found = response.channels?.find((entry) => entry.name !== undefined && channelNameKey(entry.name) === name);
    if (found?.id) return found.id;
    cursor = takeUnseenSlackCursor(seenCursors, response.response_metadata?.next_cursor);
  } while (cursor);

  return undefined;
}

function channelNameKey(name: string): string {
  return name.normalize('NFC').toLowerCase();
}
