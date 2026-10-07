/** Pages and rows one read may gather; beyond them the read says it saw part of the data. */
export const MAX_HTTP_PAGES = 10;
export const MAX_HTTP_ROWS = 1_000;

const TOTAL_KEYS = ['total', 'totalCount', 'total_count', 'count'] as const;
const TOTAL_PAGE_KEYS = ['total_pages', 'totalPages', 'last_page', 'lastPage'] as const;

export interface HttpPage {
  json: Record<string, unknown>;
  rowsPath: string;
  rows: Record<string, unknown>[];
}

/** The one property of a JSON object that holds an array of objects (its rows), if exactly one does. */
export function uniqueObjectArrayPath(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const candidates = Object.entries(value).filter(([, entry]) =>
    Array.isArray(entry) && entry.every((row) => Boolean(row) && typeof row === 'object' && !Array.isArray(row)),
  );
  return candidates.length === 1 ? candidates[0]?.[0] : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function parseHttpPage(body: string): HttpPage | undefined {
  let json: unknown;
  try {
    json = JSON.parse(body) as unknown;
  } catch {
    return undefined;
  }
  if (!json || typeof json !== 'object' || Array.isArray(json)) return undefined;
  const rowsPath = uniqueObjectArrayPath(json);
  if (!rowsPath) return undefined;
  const rows = (json as Record<string, unknown>)[rowsPath] as Record<string, unknown>[];
  return { json: json as Record<string, unknown>, rowsPath, rows };
}

function withQuery(path: string, name: string, value: number): string {
  const [base, query = ''] = path.split('?', 2) as [string, string?];
  const params = new URLSearchParams(query);
  params.set(name, String(value));
  return `${base}?${params.toString()}`;
}

/**
 * The next page as the provider itself describes it: an offset-style envelope ({ total, skip|offset,
 * limit }) or a page-style one ({ page, total_pages }). Nothing is guessed: an envelope without
 * these fields has no next page here.
 */
export function nextHttpPagePath(path: string, page: Pick<HttpPage, 'json' | 'rows'>, gathered: number): string | undefined {
  const { json } = page;
  const total = TOTAL_KEYS.map((key) => finiteNumber(json[key])).find((value) => value !== undefined);
  for (const offsetKey of ['skip', 'offset'] as const) {
    const offset = finiteNumber(json[offsetKey]);
    if (offset === undefined || total === undefined) continue;
    const next = offset + page.rows.length;
    return page.rows.length > 0 && next < total ? withQuery(path, offsetKey, next) : undefined;
  }
  const current = finiteNumber(json.page);
  const totalPages = TOTAL_PAGE_KEYS.map((key) => finiteNumber(json[key])).find((value) => value !== undefined);
  if (current !== undefined && totalPages !== undefined) return current < totalPages && page.rows.length > 0 ? withQuery(path, 'page', current + 1) : undefined;
  if (current !== undefined && total !== undefined && gathered < total && page.rows.length > 0) return withQuery(path, 'page', current + 1);
  return undefined;
}

export interface GatheredHttpPages {
  /** The first page's envelope holding every gathered row; undefined when nothing beyond it was read. */
  body?: string;
  pages: number;
  rows: number;
  /** Every page the provider described was read. */
  complete: boolean;
}

/**
 * Every page of a paged JSON read, merged into the first page's envelope so a table, its filter
 * and its totals see the whole dataset rather than the provider's first page. Each further page is
 * the same read with only its page parameter moved; `read` returns its body, or undefined to stop.
 */
export async function gatherHttpPages(
  path: string,
  firstBody: string,
  read: (path: string) => Promise<string | undefined>,
): Promise<GatheredHttpPages> {
  const first = parseHttpPage(firstBody);
  if (!first) return { pages: 1, rows: 0, complete: false };
  const rows = [...first.rows];
  let page = first;
  let currentPath = path;
  let pages = 1;
  let complete = false;
  while (true) {
    const next = nextHttpPagePath(currentPath, page, rows.length);
    if (!next) {
      complete = true;
      break;
    }
    if (pages >= MAX_HTTP_PAGES || rows.length >= MAX_HTTP_ROWS) break;
    const nextBody = await read(next);
    const nextPage = nextBody === undefined ? undefined : parseHttpPage(nextBody);
    if (!nextPage || nextPage.rowsPath !== first.rowsPath) break;
    rows.push(...nextPage.rows.slice(0, MAX_HTTP_ROWS - rows.length));
    page = nextPage;
    currentPath = next;
    pages += 1;
  }
  if (pages === 1) return { pages, rows: rows.length, complete };
  const merged = { ...first.json, [first.rowsPath]: rows };
  if ('skip' in merged) merged.skip = 0;
  if ('offset' in merged) merged.offset = 0;
  if ('limit' in merged) merged.limit = rows.length;
  return { body: JSON.stringify(merged), pages, rows: rows.length, complete };
}

export function gatheredCompleteness(gathered: GatheredHttpPages) {
  return gathered.complete
    ? { status: 'complete' as const, observedCount: gathered.rows, hasMore: false }
    : { status: 'partial' as const, reason: 'provider_limit' as const, observedCount: gathered.rows, hasMore: true };
}
