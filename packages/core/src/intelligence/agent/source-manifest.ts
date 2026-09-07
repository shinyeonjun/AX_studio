/** Compact metadata shared by the initial prompt and explicit session source lookup. */
export function sourceManifestPage(
  sources: readonly unknown[],
  options: { query?: string; offset?: number; limit?: number } = {},
) {
  const offset = options.offset ?? 0;
  const limit = options.limit ?? 20;
  const query = options.query?.normalize('NFKC').toLowerCase();
  const matches = sources.filter((value): value is Record<string, unknown> => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const source = value as Record<string, unknown>;
    if (typeof source.id !== 'string' || typeof source.fileName !== 'string') return false;
    return !query || source.fileName.normalize('NFKC').toLowerCase().includes(query) || source.id === options.query;
  });
  const page = matches.slice(offset, offset + limit).map(source => {
    const summary = source.summary && typeof source.summary === 'object'
      ? source.summary as Record<string, unknown> : {};
    return {
      id: source.id,
      fileName: (source.fileName as string).slice(0, 240),
      status: source.status,
      ...(typeof summary.pageCount === 'number' ? { pageCount: summary.pageCount } : {}),
      ...(typeof source.errorCode === 'string' ? { errorCode: source.errorCode.slice(0, 160) } : {}),
    };
  });
  const end = offset + page.length;
  return {
    sources: page,
    total: matches.length,
    truncated: end < matches.length,
    ...(end < matches.length ? { nextOffset: end } : {}),
  };
}
