export function takeUnseenSlackCursor(
  seen: Set<string>,
  cursor: string | null | undefined,
): string | undefined {
  const next = cursor || undefined;
  if (!next || seen.has(next)) return undefined;
  seen.add(next);
  return next;
}
