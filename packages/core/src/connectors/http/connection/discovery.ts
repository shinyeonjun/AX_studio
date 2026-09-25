import type { HttpAuthConfig, HttpDiscoveredReadOperation } from './contracts.js';
import { performHttpRequest } from '../request/execute.js';

const MAX_DISCOVERED_OPERATIONS = 200;
const MAX_DISCOVERY_RESPONSE_BYTES = 256 * 1024;
const MAX_OPERATION_PATH_CHARS = 512;
const MAX_OPERATION_LABEL_CHARS = 160;

function decodeHtml(value: string): string {
  return value.replace(/&(?:amp|lt|gt|quot|apos|nbsp|#39);|&#(?:x[\da-f]{1,6}|\d{1,7});/giu, (entity) => {
    const named: Record<string, string> = {
      '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&nbsp;': ' ', '&#39;': "'",
    };
    const normalized = entity.toLowerCase();
    if (named[normalized]) return named[normalized];
    const numeric = /^&#(?:x([\da-f]+)|(\d+));$/iu.exec(entity);
    const codePoint = numeric?.[1] ? Number.parseInt(numeric[1], 16) : numeric?.[2] ? Number(numeric[2]) : NaN;
    return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
      ? String.fromCodePoint(codePoint)
      : entity;
  });
}

function labelFromPath(path: string): string {
  return path.split('/').filter(Boolean).at(-1)!
    .replace(/[-_]+/gu, ' ')
    .replace(/([a-z])([A-Z])/gu, '$1 $2')
    .slice(0, MAX_OPERATION_LABEL_CHARS);
}

function safeOperationPath(base: URL, basePath: string, href: string): string | undefined {
  try {
    const target = new URL(href, base);
    if (target.origin !== base.origin || target.username || target.password) return undefined;
    const pathname = target.pathname.replace(/\/$/u, '');
    if (!pathname.startsWith(basePath) || pathname.length <= basePath.length) return undefined;
    const path = pathname.slice(basePath.length);
    if (path.length > MAX_OPERATION_PATH_CHARS
      || /[\\\s{}]/u.test(path)
      || /%(?:2f|5c)/iu.test(path)
      || /(?:^|\/)(?:\.{1,2})(?:\/|$)/u.test(path)
      || /\.[a-z\d]{1,8}$/iu.test(path)
      || /(?:^|\/)(?:docs?|swagger|openapi|assets?|static|public)(?:\/|$)/iu.test(path)) return undefined;
    return path;
  } catch {
    return undefined;
  }
}

function collectJsonLinks(value: unknown, found: Array<{ href: string; label?: string }>, depth = 0): void {
  if (depth > 5 || found.length >= MAX_DISCOVERED_OPERATIONS || !value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const entry of value) collectJsonLinks(entry, found, depth + 1);
    return;
  }
  const record = value as Record<string, unknown>;
  const href = typeof record.href === 'string' ? record.href
    : typeof record.url === 'string' ? record.url
      : undefined;
  if (href) {
    const label = [record.title, record.name, record.rel]
      .find((candidate): candidate is string => typeof candidate === 'string' && Boolean(candidate.trim()));
    found.push({ href, ...(label ? { label: label.trim() } : {}) });
    return;
  }
  for (const [key, child] of Object.entries(record)) {
    if (key === 'links' || key === '_links') {
      if (child && typeof child === 'object' && !Array.isArray(child)) {
        for (const [relation, link] of Object.entries(child)) {
          if (typeof link === 'string') found.push({ href: link, label: relation });
          else collectJsonLinks(link, found, depth + 1);
        }
      } else {
        collectJsonLinks(child, found, depth + 1);
      }
    }
  }
}

/** Parse only links advertised by the connected service itself; all paths stay under its base URL. */
export function extractHttpReadOperations(
  baseUrl: string,
  contentType: string | undefined,
  body: string,
): HttpDiscoveredReadOperation[] {
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    return [];
  }
  base.search = '';
  base.hash = '';
  base.pathname = base.pathname.endsWith('/') ? base.pathname : `${base.pathname}/`;
  const basePath = base.pathname;
  const links: Array<{ href: string; label?: string }> = [];

  if (/\btext\/html\b/iu.test(contentType ?? '')) {
    const anchors = /<a\b([^>]*)\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))([^>]*)>([\s\S]*?)<\/a\s*>/giu;
    for (const match of body.matchAll(anchors)) {
      const attributes = `${match[1]} ${match[5]}`;
      if (!/\btarget\s*=\s*["']?_blank\b/iu.test(attributes)) continue;
      const href = match[2] ?? match[3] ?? match[4];
      if (!href) continue;
      const label = decodeHtml((match[6] ?? '')
        .replace(/<(?:script|style)\b[^>]*>[\s\S]*?<\/(?:script|style)\s*>/giu, ' ')
        .replace(/<[^>]*>/gu, ' '))
        .replace(/\bhttps?:\/\/[^\s<]+/giu, ' ')
        .replace(/\s+/gu, ' ')
        .trim();
      links.push({ href, ...(label ? { label } : {}) });
      if (links.length >= MAX_DISCOVERED_OPERATIONS) break;
    }
  } else if (/\b(?:application|text)\/(?:[\w.+-]*\+)?json\b/iu.test(contentType ?? '')) {
    try {
      collectJsonLinks(JSON.parse(body), links);
    } catch {
      return [];
    }
  }

  const seen = new Set<string>();
  const operations: HttpDiscoveredReadOperation[] = [];
  for (const link of links) {
    const path = safeOperationPath(base, basePath, link.href);
    if (!path || seen.has(path.toLocaleLowerCase())) continue;
    seen.add(path.toLocaleLowerCase());
    const label = (link.label?.replace(/\s+/gu, ' ').trim() || labelFromPath(path))
      .slice(0, MAX_OPERATION_LABEL_CHARS);
    operations.push({ path, label });
    if (operations.length >= MAX_DISCOVERED_OPERATIONS) break;
  }
  return operations;
}

/** Best-effort, bounded GET of the API root. Failure never blocks saving a connection. */
export async function discoverHttpReadOperations(
  baseUrl: string,
  auth?: HttpAuthConfig,
): Promise<HttpDiscoveredReadOperation[]> {
  const result = await performHttpRequest({
    url: baseUrl,
    method: 'GET',
    auth,
    timeoutMs: 2_000,
    maxBytes: MAX_DISCOVERY_RESPONSE_BYTES,
    rejectPrivateDestination: true,
  });
  if (!result.ok) throw new Error(`http_read_discovery_${result.errorCode}`);
  if (result.status === 404) return [];
  if (result.status < 200 || result.status >= 300 || result.truncated) {
    throw new Error('http_read_discovery_incomplete');
  }
  return extractHttpReadOperations(baseUrl, result.headers['content-type'], result.body);
}
