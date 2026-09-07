import type { gmail_v1 } from 'googleapis';
import { z } from 'zod';
import { completeArtifactCompleteness, partialArtifactCompleteness } from '../../contracts/artifacts/completeness.js';

const Params = z.object({
  query: z.string().default(''),
  limit: z.coerce.number().finite().transform((n) => Math.min(50, Math.max(1, Math.trunc(n)))).default(10),
  pageToken: z.string().min(1).max(4096).optional(),
});

/** One provider page; callers retain the query and pass nextPageToken to continue. */
export async function searchGmailMessagePage(gmail: gmail_v1.Gmail, params: Record<string, unknown>, signal?: AbortSignal) {
  const { query, limit, pageToken } = Params.parse(params);
  signal?.throwIfAborted();
  const response = await gmail.users.messages.list({ userId: 'me', q: query, maxResults: limit, pageToken });
  signal?.throwIfAborted();
  const messages = response.data.messages ?? [];
  // Slicing an oversized provider page would skip rows when using its next token.
  if (messages.length > limit) throw new Error('page_size_exceeded');
  const nextPageToken = response.data.nextPageToken || undefined;
  if (nextPageToken && nextPageToken === pageToken) throw new Error('pagination_cycle');
  const estimate = response.data.resultSizeEstimate;
  return {
    messages,
    hits: messages.filter((message) => message.id).map((message) => ({
      ref: { connector: 'gmail', kind: 'email' as const, id: message.id! }, score: 1,
    })),
    limit,
    truncated: Boolean(nextPageToken),
    completeness: pageToken || nextPageToken
      ? partialArtifactCompleteness('provider_limit', { observedCount: messages.length, limit, hasMore: Boolean(nextPageToken) })
      : completeArtifactCompleteness(messages.length),
    ...(nextPageToken ? { nextPageToken } : {}),
    ...(typeof estimate === 'number' && Number.isFinite(estimate) && estimate >= 0
      ? { resultSizeEstimate: estimate, total: estimate, totalIsEstimate: true } : {}),
  };
}
