const MAX_PAGES = 20;

export function takeUnseenSlackCursor(
  seen: Set<string>,
  cursor: string | null | undefined,
): string | undefined {
  const next = cursor?.trim() || undefined;
  if (!next) return undefined;
  if (seen.has(next)) throw new Error('pagination_cycle');
  if (seen.size >= MAX_PAGES - 1) throw new Error('pagination_limit');
  seen.add(next);
  return next;
}

export function nextSlackHistoryPage(
  seen: Set<string>,
  response: {
    response_metadata?: { next_cursor?: string };
    has_more?: boolean;
    messages?: Array<{ ts?: string }>;
  },
  latest?: string,
): { cursor?: string; latest?: string } | undefined {
  const cursor = takeUnseenSlackCursor(seen, response.response_metadata?.next_cursor);
  if (cursor) return { cursor, ...(latest ? { latest } : {}) };
  if (!response.has_more) return undefined;
  const nextLatest = response.messages?.at(-1)?.ts;
  if (!nextLatest || !/^\d+\.\d+$/.test(nextLatest)) throw new Error('pagination_incomplete');
  if (latest && Number(nextLatest) >= Number(latest)) throw new Error('pagination_cycle');
  takeUnseenSlackCursor(seen, `latest:${nextLatest}`);
  return { latest: nextLatest };
}
