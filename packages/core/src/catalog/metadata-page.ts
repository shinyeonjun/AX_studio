/** Bound model-facing inventories, preserving exact IDs and a usable continuation. */
export function metadataPage<T>(
  items: readonly T[],
  args: Record<string, unknown> = {},
  searchable: (item: T) => readonly (string | undefined)[],
) {
  const offset = args.offset ?? 0;
  const limit = args.limit ?? 20;
  if (typeof offset !== 'number' || !Number.isSafeInteger(offset) || offset < 0
    || typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 20
    || (args.query !== undefined && (typeof args.query !== 'string' || args.query.length > 500))) {
    throw new Error('invalid_catalog_pagination');
  }
  const query = typeof args.query === 'string' ? args.query.trim().normalize('NFKC').toLowerCase() : '';
  const matches = query ? items.filter(item => searchable(item).some(value =>
    value?.normalize('NFKC').toLowerCase().includes(query))) : items;
  const end = offset + limit;
  return { items: matches.slice(offset, end), total: matches.length,
    truncated: end < matches.length, ...(end < matches.length ? { nextOffset: end } : {}) };
}
