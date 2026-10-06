import { isIP } from 'node:net';

export interface ResolvedHttpUrl {
  url: string;
  origin: string;
}

export type ResolveHttpUrlResult =
  | { ok: true; value: ResolvedHttpUrl }
  | { ok: false; error: string; errorCode: string };

const PRIVATE_HOST_SUFFIXES = ['.localhost', '.local', '.internal'];

/** IPv4 special-purpose ranges as [network as uint32, prefix length]. */
const PRIVATE_IPV4_CIDRS: ReadonlyArray<readonly [number, number]> = [
  [ipv4ToInt(0, 0, 0, 0), 8],
  [ipv4ToInt(10, 0, 0, 0), 8],
  [ipv4ToInt(100, 64, 0, 0), 10],
  [ipv4ToInt(127, 0, 0, 0), 8],
  [ipv4ToInt(169, 254, 0, 0), 16],
  [ipv4ToInt(172, 16, 0, 0), 12],
  [ipv4ToInt(192, 0, 0, 0), 24],
  [ipv4ToInt(192, 168, 0, 0), 16],
  [ipv4ToInt(198, 18, 0, 0), 15],
  [ipv4ToInt(224, 0, 0, 0), 4],
  [ipv4ToInt(240, 0, 0, 0), 4],
];

function ipv4ToInt(a: number, b: number, c: number, d: number): number {
  return (((a << 24) >>> 0) + (b << 16) + (c << 8) + d) >>> 0;
}

function isPrivateIpv4Int(value: number): boolean {
  return PRIVATE_IPV4_CIDRS.some(([network, prefix]) => {
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
    return ((value & mask) >>> 0) === network;
  });
}

function parseIpv4(host: string): number | null {
  if (isIP(host) !== 4) return null;
  const [a, b, c, d] = host.split('.').map((part) => Number(part));
  return ipv4ToInt(a!, b!, c!, d!);
}

/** Expand an IPv6 literal into eight 16-bit groups. Returns null when the literal is malformed. */
function parseIpv6(host: string): number[] | null {
  if (isIP(host) !== 6) return null;
  let text = host;
  const tail: number[] = [];
  const dotted = text.match(/^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/u);
  if (dotted) {
    const ipv4 = parseIpv4(dotted[2]!);
    if (ipv4 === null) return null;
    tail.push(ipv4 >>> 16, ipv4 & 0xffff);
    text = dotted[1]!.endsWith('::') ? dotted[1]! : dotted[1]!.slice(0, -1);
  }
  const [head, rest] = text.split('::');
  const parseGroups = (part: string | undefined): number[] =>
    part ? part.split(':').filter((group) => group.length > 0).map((group) => Number.parseInt(group, 16)) : [];
  const headGroups = parseGroups(head);
  const restGroups = [...parseGroups(rest), ...tail];
  if (rest === undefined) {
    const groups = [...headGroups, ...tail];
    return groups.length === 8 ? groups : null;
  }
  const missing = 8 - headGroups.length - restGroups.length;
  if (missing < 0) return null;
  return [...headGroups, ...new Array<number>(missing).fill(0), ...restGroups];
}

function isPrivateIpv6Groups(groups: number[]): boolean {
  const first = groups[0]!;
  const embeddedIpv4 = ((groups[6]! << 16) >>> 0) + groups[7]!;
  const leadingZero = groups.slice(0, 5).every((group) => group === 0);
  // :: and ::1
  if (groups.slice(0, 7).every((group) => group === 0) && groups[7]! <= 1) return true;
  // IPv4-mapped ::ffff:a.b.c.d and deprecated IPv4-compatible ::a.b.c.d (any notation).
  if (leadingZero && (groups[5] === 0xffff || groups[5] === 0)) return isPrivateIpv4Int(embeddedIpv4);
  // NAT64 well-known prefix 64:ff9b::/96 (RFC 6052) and local-use 64:ff9b:1::/48 (RFC 8215).
  if (first === 0x64 && groups[1] === 0xff9b) {
    if (groups.slice(2, 6).every((group) => group === 0)) return isPrivateIpv4Int(embeddedIpv4);
    if (groups[2] === 1) return true;
  }
  // 6to4 2002:WWXX:YYZZ::/48 embeds an IPv4 address in groups 1-2.
  if (first === 0x2002) return isPrivateIpv4Int(((groups[1]! << 16) >>> 0) + groups[2]!);
  return (first & 0xfe00) === 0xfc00 // fc00::/7 unique local
    || (first & 0xffc0) === 0xfe80 // fe80::/10 link-local
    || (first & 0xffc0) === 0xfec0 // fec0::/10 deprecated site-local
    || (first & 0xff00) === 0xff00; // ff00::/8 multicast
}

/**
 * True when the hostname is a local name or an IP literal in a special-purpose
 * (non-globally-routable) range. Also used on DNS answers before connecting.
 */
export function isPrivateHttpHostname(hostname: string): boolean {
  let host = hostname.trim().toLowerCase().replace(/^\[/u, '').replace(/\]$/u, '').replace(/\.$/u, '');
  const zoneIndex = host.indexOf('%');
  if (zoneIndex !== -1) host = host.slice(0, zoneIndex);
  if (!host) return true;
  if (host === 'localhost' || PRIVATE_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) return true;
  const family = isIP(host);
  if (family === 4) return isPrivateIpv4Int(parseIpv4(host)!);
  if (family === 6) {
    const groups = parseIpv6(host);
    // Fail closed on IPv6 literals we cannot expand.
    return groups === null || isPrivateIpv6Groups(groups);
  }
  return false;
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
