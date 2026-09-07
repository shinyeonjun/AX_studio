const MAX_PAGES = 20;

export function nextGmailPage(seen: Set<string>, token: string | null | undefined): string | undefined {
  if (!token) return undefined;
  if (seen.has(token)) throw new Error('pagination_cycle');
  if (seen.size >= MAX_PAGES - 1) throw new Error('pagination_limit');
  seen.add(token);
  return token;
}
