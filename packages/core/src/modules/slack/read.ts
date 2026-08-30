import type { WebClient } from '@slack/web-api';
import type { SearchHit } from '../../platform/knowledge.js';
import { resolveSlackChannelId } from './channel-resolve.js';
import { takeUnseenSlackCursor } from './pagination.js';

const MAX_CHANNELS = 200;
const MAX_MESSAGES = 50;
const MAX_SEARCH = 50;
const DEFAULT_LIMIT = 20;

function normalizeLimit(limit: number, max: number): number {
  const integer = Number.isFinite(limit) ? Math.trunc(limit) : DEFAULT_LIMIT;
  return Math.min(Math.max(integer, 1), max);
}

export interface SlackChannelSummary {
  id: string;
  name?: string;
  isPrivate?: boolean;
  numMembers?: number;
}

export interface SlackMessageSummary {
  ts?: string;
  text?: string;
  user?: string;
  threadTs?: string;
}

export async function listSlackChannels(client: WebClient): Promise<SlackChannelSummary[]> {
  const channels: SlackChannelSummary[] = [];
  const seenChannelIds = new Set<string>();
  let cursor: string | undefined;
  const seenCursors = new Set<string>();

  do {
    const response = await client.conversations.list({
      types: 'public_channel,private_channel',
      limit: 200,
      cursor,
    });
    for (const entry of response.channels ?? []) {
      if (!entry.id || seenChannelIds.has(entry.id)) continue;
      seenChannelIds.add(entry.id);
      channels.push({
        id: entry.id,
        name: entry.name,
        isPrivate: entry.is_private,
        numMembers: entry.num_members,
      });
      if (channels.length >= MAX_CHANNELS) return channels;
    }
    cursor = takeUnseenSlackCursor(seenCursors, response.response_metadata?.next_cursor);
  } while (cursor);

  return channels;
}

export async function searchSlackMessages(
  client: WebClient,
  query: string,
  limit = DEFAULT_LIMIT,
): Promise<{ hits: SearchHit[]; matches: Array<Record<string, unknown>> }> {
  const boundedLimit = normalizeLimit(limit, MAX_SEARCH);
  const response = await client.search.messages({ query, count: boundedLimit });
  const matches = response.messages?.matches ?? [];
  const hits: SearchHit[] = [];
  const rows: Array<Record<string, unknown>> = [];

  for (const match of matches) {
    const channelId = match.channel?.id ?? '';
    const ts = match.ts ?? '';
    const text = match.text ?? '';
    const ref = {
      connector: 'slack',
      kind: 'message' as const,
      id: channelId && ts ? `${channelId}:${ts}` : ts || channelId,
      label: match.channel?.name ? `#${match.channel.name}` : channelId,
    };
    hits.push({ ref, score: 1, snippet: text.slice(0, 240) });
    rows.push({
      channel: match.channel?.name,
      channelId,
      ts,
      text,
      user: match.user,
      permalink: match.permalink,
    });
  }

  return { hits, matches: rows };
}

export async function readSlackChannelMessages(
  client: WebClient,
  channel: string,
  limit = DEFAULT_LIMIT,
): Promise<{ channel: string; channelId: string; messages: SlackMessageSummary[] }> {
  const channelId = await resolveSlackChannelId(client, channel);
  if (!channelId) {
    throw new Error('channel_not_found');
  }

  const boundedLimit = normalizeLimit(limit, MAX_MESSAGES);
  const messages: SlackMessageSummary[] = [];
  const seenMessageTimestamps = new Set<string>();
  let cursor: string | undefined;
  const seenCursors = new Set<string>();

  do {
    const response = await client.conversations.history({ channel: channelId, limit: boundedLimit, cursor });
    for (const message of response.messages ?? []) {
      if (message.type !== 'message' || message.subtype) continue;
      if (message.ts && seenMessageTimestamps.has(message.ts)) continue;
      if (message.ts) seenMessageTimestamps.add(message.ts);
      messages.push({
        ts: message.ts,
        text: message.text,
        user: message.user,
        threadTs: message.thread_ts,
      });
      if (messages.length >= boundedLimit) break;
    }
    cursor = takeUnseenSlackCursor(seenCursors, response.response_metadata?.next_cursor);
  } while (messages.length < boundedLimit && cursor);

  return { channel, channelId, messages };
}
