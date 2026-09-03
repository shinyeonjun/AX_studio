const MAX_SEEN_MESSAGE_IDS = 500;

export function trimSeenIds(ids: string[]): string[] {
  if (ids.length <= MAX_SEEN_MESSAGE_IDS) return ids;
  return ids.slice(ids.length - MAX_SEEN_MESSAGE_IDS);
}

export function isNotFoundError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as { code?: unknown; status?: unknown };
  return candidate.code === 404
    || candidate.code === '404'
    || candidate.status === 404
    || candidate.status === '404';
}
