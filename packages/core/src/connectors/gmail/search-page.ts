import type { gmail_v1 } from 'googleapis';
import { z } from 'zod';
import { completeArtifactCompleteness, partialArtifactCompleteness } from '../../contracts/artifacts/completeness.js';
import { isNotFoundError } from './new-message-poll/shared.js';

const Params = z.object({
  query: z.string().default(''),
  limit: z.coerce.number().finite().transform((n) => Math.min(50, Math.max(1, Math.trunc(n)))).default(10),
  pageToken: z.string().min(1).max(4096).optional(),
  includeMetadata: z.preprocess((value) => {
    if (typeof value !== 'string') return value;
    if (value.trim().toLowerCase() === 'true') return true;
    if (value.trim().toLowerCase() === 'false') return false;
    return value;
  }, z.boolean()).default(false),
});
const METADATA_HEADERS = ['From', 'Subject', 'Date'] as const;
const METADATA_BATCH_SIZE = 8;

function metadataHeader(
  headers: gmail_v1.Schema$MessagePartHeader[] | undefined,
  name: string,
): string | undefined {
  const header = headers?.find((entry) => entry.name?.toLowerCase() === name.toLowerCase());
  const value = header?.value?.trim();
  return value || undefined;
}

async function addMessageMetadata(
  gmail: gmail_v1.Gmail,
  messages: gmail_v1.Schema$Message[],
  signal?: AbortSignal,
): Promise<gmail_v1.Schema$Message[]> {
  // Keep the page usable with a list-only transport double; the real Gmail
  // client always exposes messages.get.
  if (typeof gmail.users.messages.get !== 'function') return messages;
  const enriched: gmail_v1.Schema$Message[] = [];
  for (let offset = 0; offset < messages.length; offset += METADATA_BATCH_SIZE) {
    signal?.throwIfAborted();
    const batch = await Promise.all(messages.slice(offset, offset + METADATA_BATCH_SIZE).map(async (message) => {
      if (!message.id) return message;
      signal?.throwIfAborted();
      try {
        const response = await gmail.users.messages.get({
          userId: 'me',
          id: message.id,
          format: 'metadata',
          metadataHeaders: [...METADATA_HEADERS],
        });
        signal?.throwIfAborted();
        const headers = response.data.payload?.headers;
        return {
          ...message,
          ...(metadataHeader(headers, 'From') ? { from: metadataHeader(headers, 'From') } : {}),
          ...(metadataHeader(headers, 'Subject') ? { subject: metadataHeader(headers, 'Subject') } : {}),
          ...(metadataHeader(headers, 'Date') ? { date: metadataHeader(headers, 'Date') } : {}),
        };
      } catch (error) {
        if (isNotFoundError(error)) return message;
        throw error;
      }
    }));
    enriched.push(...batch);
  }
  return enriched;
}

/** One provider page; callers retain the query and pass nextPageToken to continue. */
export async function searchGmailMessagePage(gmail: gmail_v1.Gmail, params: Record<string, unknown>, signal?: AbortSignal) {
  const { query, limit, pageToken, includeMetadata } = Params.parse(params);
  signal?.throwIfAborted();
  const response = await gmail.users.messages.list({ userId: 'me', q: query, maxResults: limit, pageToken });
  signal?.throwIfAborted();
  const messages = response.data.messages ?? [];
  // Slicing an oversized provider page would skip rows when using its next token.
  if (messages.length > limit) throw new Error('page_size_exceeded');
  const enrichedMessages = includeMetadata
    ? await addMessageMetadata(gmail, messages, signal)
    : messages;
  const nextPageToken = response.data.nextPageToken || undefined;
  if (nextPageToken && nextPageToken === pageToken) throw new Error('pagination_cycle');
  const estimate = response.data.resultSizeEstimate;
  return {
    messages: enrichedMessages,
    hits: enrichedMessages.filter((message) => message.id).map((message) => ({
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
