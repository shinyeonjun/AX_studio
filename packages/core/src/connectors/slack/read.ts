import type { WebClient } from '@slack/web-api';
import type { SearchHit } from '../../platform/knowledge.js';
import { resolveSlackChannelId } from './channel-resolve.js';
import { nextSlackHistoryPage, takeUnseenSlackCursor } from './pagination.js';
import { slackRequest } from './request.js';

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

export async function listSlackChannels(client: WebClient, signal?: AbortSignal): Promise<SlackChannelSummary[]> {
  const channels: SlackChannelSummary[] = [];
  const seenChannelIds = new Set<string>();
  let cursor: string | undefined;
  const seenCursors = new Set<string>();

  do {
    const response = await slackRequest(() => client.conversations.list({
      types: 'public_channel,private_channel',
      limit: 200,
      cursor,
    }), signal);
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
  signal?: AbortSignal,
): Promise<{ hits: SearchHit[]; matches: Array<Record<string, unknown>> }> {
  const boundedLimit = normalizeLimit(limit, MAX_SEARCH);
  const hits: SearchHit[] = [];
  const rows: Array<Record<string, unknown>> = [];
  const seenMessages = new Set<string>();
  const seenPages = new Set<string>();
  let page = 1;

  do {
    const response = await slackRequest(() => client.search.messages({
      query, count: boundedLimit, ...(page > 1 ? { page } : {}),
    }), signal);
    for (const match of response.messages?.matches ?? []) {
      const channelId = match.channel?.id ?? '';
      const ts = match.ts ?? '';
      const text = match.text ?? '';
      const ref = {
        connector: 'slack',
        kind: 'message' as const,
        id: channelId && ts ? `${channelId}:${ts}` : ts || channelId,
        label: match.channel?.name ? `#${match.channel.name}` : channelId,
      };
      if (!ref.id || seenMessages.has(ref.id)) continue;
      seenMessages.add(ref.id);
      hits.push({ ref, score: 1, snippet: text.slice(0, 240) });
      rows.push({
        channel: match.channel?.name,
        channelId,
        ts,
        text,
        user: match.user,
        permalink: match.permalink,
      });
      if (hits.length >= boundedLimit) return { hits, matches: rows };
    }
    const pages = response.messages?.paging?.pages ?? response.messages?.pagination?.page_count ?? 1;
    if (page >= pages) break;
    page += 1;
    takeUnseenSlackCursor(seenPages, String(page));
  } while (true);

  return { hits, matches: rows };
}

export async function readSlackChannelMessages(
  client: WebClient,
  channel: string,
  limit = DEFAULT_LIMIT,
  signal?: AbortSignal,
): Promise<{ channel: string; channelId: string; messages: SlackMessageSummary[] }> {
  const channelId = await resolveSlackChannelId(client, channel, signal);
  if (!channelId) {
    throw new Error('channel_not_found');
  }

  const boundedLimit = normalizeLimit(limit, MAX_MESSAGES);
  const messages: SlackMessageSummary[] = [];
  const seenMessageTimestamps = new Set<string>();
  let page: { cursor?: string; latest?: string } | undefined;
  const seenCursors = new Set<string>();

  do {
    const response = await slackRequest(() => client.conversations.history({
      channel: channelId, limit: boundedLimit, cursor: page?.cursor,
      ...(page?.latest ? { latest: page.latest } : {}),
    }), signal);
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
    if (messages.length >= boundedLimit) break;
    page = nextSlackHistoryPage(seenCursors, response, page?.latest);
  } while (page);

  return { channel, channelId, messages };
}
