export interface ResolvedHttpUrl {
  url: string;
  origin: string;
}

export type ResolveHttpUrlResult =
  | { ok: true; value: ResolvedHttpUrl }
  | { ok: false; error: string; errorCode: string };

function normalizeBasePath(pathname: string): string {
  if (!pathname || pathname === '/') return '/';
  return pathname.endsWith('/') ? pathname : `${pathname}/`;
}

/** Resolve a relative path against a connection base URL. Blocks absolute and off-origin targets. */
export function resolveHttpRequestUrl(baseUrl: string, path: string): ResolveHttpUrlResult {
  const trimmedPath = path.trim();
  if (!trimmedPath) {
    return { ok: false, error: 'path_required', errorCode: 'invalid_params' };
  }
  if (trimmedPath.includes('://') || trimmedPath.startsWith('//')) {
    return { ok: false, error: 'absolute_url_not_allowed', errorCode: 'ssrf_blocked' };
  }
  const rawPathname = trimmedPath.split(/[?#]/, 1)[0]!;
  if (/%(?:2f|5c)/i.test(rawPathname)) {
    return { ok: false, error: 'encoded_path_separator_not_allowed', errorCode: 'ssrf_blocked' };
  }

  let base: URL;
  try {
    base = new URL(baseUrl.trim().endsWith('/') ? baseUrl.trim() : `${baseUrl.trim()}/`);
  } catch {
    return { ok: false, error: 'invalid_base_url', errorCode: 'invalid_params' };
  }
  if (base.protocol !== 'http:' && base.protocol !== 'https:') {
    return { ok: false, error: 'unsupported_protocol', errorCode: 'ssrf_blocked' };
  }

  const relative = trimmedPath.startsWith('/') ? trimmedPath.slice(1) : trimmedPath;
  let resolved: URL;
  try {
    resolved = new URL(relative, base);
  } catch {
    return { ok: false, error: 'invalid_path', errorCode: 'invalid_params' };
  }

  if (resolved.origin !== base.origin) {
    return { ok: false, error: 'url_outside_base', errorCode: 'ssrf_blocked' };
  }

  const basePrefix = normalizeBasePath(base.pathname);
  const resolvedPath = resolved.pathname.endsWith('/') ? resolved.pathname : `${resolved.pathname}/`;
  if (!resolvedPath.startsWith(basePrefix) && resolved.pathname !== base.pathname.replace(/\/$/, '')) {
    return { ok: false, error: 'path_outside_base', errorCode: 'ssrf_blocked' };
  }

  return { ok: true, value: { url: resolved.toString(), origin: resolved.origin } };
}
