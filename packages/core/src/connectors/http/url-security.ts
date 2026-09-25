export interface ResolvedHttpUrl {
  url: string;
  origin: string;
}

export type ResolveHttpUrlResult =
  | { ok: true; value: ResolvedHttpUrl }
  | { ok: false; error: string; errorCode: string };

export function isPrivateHttpHostname(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/^\[/u, '').replace(/\]$/u, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return true;
  const ipv4 = host.split('.').map((part) => Number(part));
  if (ipv4.length === 4 && ipv4.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)) {
    return ipv4[0] === 10
      || ipv4[0] === 127
      || (ipv4[0] === 169 && ipv4[1] === 254)
      || (ipv4[0] === 172 && ipv4[1] >= 16 && ipv4[1] <= 31)
      || (ipv4[0] === 192 && ipv4[1] === 168)
      || ipv4[0] === 0;
  }
  const mappedIpv4 = host.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/u)?.[1];
  if (mappedIpv4 && isPrivateHttpHostname(mappedIpv4)) return true;
  return host === '::' || host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe8')
    || host.startsWith('fe9') || host.startsWith('fea') || host.startsWith('feb');
}

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
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmedPath) || trimmedPath.startsWith('//')) {
    return { ok: false, error: 'absolute_url_not_allowed', errorCode: 'ssrf_blocked' };
  }
  const rawPathname = trimmedPath.split(/[?#]/, 1)[0]!;
  if (rawPathname.includes('\\') || /%(?:2f|5c)/i.test(rawPathname)) {
    return { ok: false, error: 'encoded_path_separator_not_allowed', errorCode: 'ssrf_blocked' };
  }
  let decodedPathname: string;
  try {
    decodedPathname = decodeURIComponent(rawPathname);
  } catch {
    return { ok: false, error: 'invalid_path_encoding', errorCode: 'ssrf_blocked' };
  }
  if (/(^|\/)(?:\.{1,2})(?:\/|$)/u.test(decodedPathname)) {
    return { ok: false, error: 'path_traversal_not_allowed', errorCode: 'ssrf_blocked' };
  }

  let base: URL;
  try {
    base = new URL(baseUrl.trim());
    base.pathname = normalizeBasePath(base.pathname);
    base.search = '';
    base.hash = '';
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
