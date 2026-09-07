import type { WebClient } from '@slack/web-api';
import { z } from 'zod';
import { completeArtifactCompleteness, partialArtifactCompleteness } from '../../contracts/artifacts/completeness.js';
import { resolveSlackChannelId } from './channel-resolve.js';
import { nextSlackHistoryPage } from './pagination.js';
import { slackRequest } from './request.js';

const cursor = z.string().min(1).max(4096).optional();
const limit = (max: number, fallback: number) => z.coerce.number().finite()
  .transform((n) => Math.min(max, Math.max(1, Math.trunc(n)))).default(fallback);
const ChannelsParams = z.object({ cursor, limit: limit(200, 200) });
const SearchParams = z.object({
  query: z.string().trim().min(1), limit: limit(50, 20), cursor,
  page: z.coerce.number().int().min(1).max(100).optional(),
}).refine((params) => !(params.cursor && params.page !== undefined), 'Choose cursor or page');
const HistoryParams = z.object({
  channel: z.string().trim().min(1), limit: limit(50, 20), cursor,
  latest: z.string().regex(/^\d+\.\d+$/).max(40).optional(),
});

function checkPageSize(length: number, requested: number): void {
  if (length > requested) throw new Error('page_size_exceeded');
}

function pageCompleteness(partial: boolean, hasMore: boolean, observedCount: number, pageLimit: number) {
  return partial
    ? partialArtifactCompleteness('provider_limit', { observedCount, limit: pageLimit, hasMore })
    : completeArtifactCompleteness(observedCount);
}

export async function listSlackChannelPage(client: WebClient, params: Record<string, unknown>, signal?: AbortSignal) {
  const options = ChannelsParams.parse(params);
  const response = await slackRequest(() => client.conversations.list({
    types: 'public_channel,private_channel', ...options,
  }), signal);
  checkPageSize(response.channels?.length ?? 0, options.limit);
  const nextCursor = response.response_metadata?.next_cursor?.trim() || undefined;
  if (nextCursor && nextCursor === options.cursor) throw new Error('pagination_cycle');
  const seen = new Set<string>();
  const channels = (response.channels ?? []).filter((entry) => {
    if (!entry.id || seen.has(entry.id)) return false;
    seen.add(entry.id);
    return true;
  }).map((entry) => ({ id: entry.id!, name: entry.name, isPrivate: entry.is_private, numMembers: entry.num_members }));
  return { channels, limit: options.limit, truncated: Boolean(nextCursor),
    completeness: pageCompleteness(Boolean(options.cursor || nextCursor), Boolean(nextCursor), channels.length, options.limit),
    ...(nextCursor ? { nextCursor } : {}) };
}

export async function searchSlackMessagePage(client: WebClient, params: Record<string, unknown>, signal?: AbortSignal) {
  const options = SearchParams.parse(params);
  const response = await slackRequest(() => client.search.messages({
    query: options.query, count: options.limit,
    ...(options.page === undefined ? { cursor: options.cursor ?? '*' } : { page: options.page }),
  }), signal);
  checkPageSize(response.messages?.matches?.length ?? 0, options.limit);
  const seen = new Set<string>();
  const matches = (response.messages?.matches ?? []).filter((match) => {
    const id = `${match.channel?.id ?? ''}:${match.ts ?? ''}`;
    if (!match.channel?.id || !match.ts || seen.has(id)) return false;
    seen.add(id);
    return true;
  }).map((match) => ({ channel: match.channel?.name, channelId: match.channel!.id!, ts: match.ts!,
    text: match.text ?? '', user: match.user, permalink: match.permalink }));
  const nextCursor = response.response_metadata?.next_cursor?.trim() || undefined;
  if (nextCursor && nextCursor === (options.cursor ?? '*')) throw new Error('pagination_cycle');
  const page = response.messages?.paging?.page ?? response.messages?.pagination?.page ?? options.page ?? 1;
  const total = response.messages?.total ?? response.messages?.paging?.total ?? response.messages?.pagination?.total_count;
  const pages = response.messages?.paging?.pages ?? response.messages?.pagination?.page_count;
  const cursorPaging = options.page === undefined && response.response_metadata?.next_cursor !== undefined;
  const morePages = !cursorPaging && (typeof pages === 'number' ? page < pages
    : typeof total === 'number' && page * options.limit < total);
  const nextPage = !nextCursor && morePages && page < 100 ? page + 1 : undefined;
  return {
    hits: matches.map((match) => ({ ref: { connector: 'slack', kind: 'message' as const,
      id: `${match.channelId}:${match.ts}`, label: match.channel ? `#${match.channel}` : match.channelId },
    score: 1, snippet: match.text.slice(0, 240) })),
    matches, limit: options.limit, page, truncated: Boolean(nextCursor || morePages),
    completeness: pageCompleteness(
      Boolean((options.cursor && options.cursor !== '*') || (options.page ?? 1) > 1 || nextCursor || morePages),
      Boolean(nextCursor || nextPage), matches.length, options.limit,
    ),
    ...(nextCursor ? { nextCursor } : {}), ...(nextPage ? { nextPage } : {}),
    ...(!nextCursor && morePages && page >= 100 ? { paginationLimitReached: true } : {}),
    ...(typeof total === 'number' && Number.isFinite(total) && total >= 0 ? { total } : {}),
  };
}

export async function readSlackMessagePage(client: WebClient, params: Record<string, unknown>, signal?: AbortSignal) {
  const options = HistoryParams.parse(params);
  const channelId = await resolveSlackChannelId(client, options.channel, signal);
  if (!channelId) throw new Error('channel_not_found');
  const response = await slackRequest(() => client.conversations.history({
    channel: channelId, limit: options.limit, cursor: options.cursor,
    ...(options.latest ? { latest: options.latest } : {}),
  }), signal);
  checkPageSize(response.messages?.length ?? 0, options.limit);
  const seen = new Set<string>();
  const messages = (response.messages ?? []).filter((message) => {
    if (message.type !== 'message' || message.subtype || !message.ts || seen.has(message.ts)) return false;
    seen.add(message.ts);
    return true;
  }).map((message) => ({ ts: message.ts!, text: message.text, user: message.user, threadTs: message.thread_ts }));
  const next = nextSlackHistoryPage(new Set(options.cursor ? [options.cursor] : []), response, options.latest);
  return {
    channel: options.channel, channelId, messages, limit: options.limit, truncated: Boolean(next),
    completeness: pageCompleteness(Boolean(options.cursor || options.latest || next), Boolean(next), messages.length, options.limit),
    ...(next?.cursor ? { nextCursor: next.cursor } : {}), ...(next?.latest ? { nextLatest: next.latest } : {}),
  };
}
