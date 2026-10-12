import { MAX_DECISION_CHOICE_CRITERIA } from '../../../../contracts/decision.js';

export interface JevHttpEndpointHint {
  id: string;
  label?: string;
  usable?: boolean;
}

export function jevHttpEndpointChoices(endpoints: readonly JevHttpEndpointHint[]) {
  const usable = endpoints.filter((endpoint) => endpoint.usable !== false);
  // The `none` answer consumes one slot in Jev's per-choice limit.
  if (usable.length + 1 > MAX_DECISION_CHOICE_CRITERIA) return [];
  return usable.map((endpoint, index) => ({ key: `http_endpoint_${index}`, endpoint }));
}

const HTTP_PATH_MAX_CHARS = 2_048;
const HTTP_PATH_TOKEN = /^[A-Za-z0-9._~!$&'()*+,;=:@%/?#-]+$/u;

function normalizeHttpPath(value: string | undefined): string | undefined {
  const candidate = value?.trim()
    .replace(/(?:에서는|에서|에게|으로|부터|까지|을|를|은|는|이|가|와|과|로|에|도|만)$/u, '')
    .replace(/[\s,;:!?。！？]+$/u, '');
  if (!candidate || candidate.length > HTTP_PATH_MAX_CHARS) return undefined;
  if (candidate.startsWith('//') || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(candidate)) return undefined;
  if (/[\s"'`<>]/u.test(candidate) || !HTTP_PATH_TOKEN.test(candidate)) return undefined;
  return candidate;
}

const HTTP_REQUEST_CUE = /(?:\b(?:HTTP|API|URL|REST|endpoint)\b|엔드포인트)/iu;
const LEADING_SLASH_PATH = /(?:^|[\s(])(\/[A-Za-z0-9_.~-]+(?:\/[A-Za-z0-9_.~-]+)*(?:\?[^\s"'`<>]*)?)/u;
const BARE_SEGMENTED_PATH = /(?:^|[\s(])([A-Za-z][A-Za-z0-9_.~-]*(?:\/[A-Za-z0-9_.~-]+)+(?:\?[^\s"'`<>]*)?)/u;

/** Path-like only when every segment is a plausible URL segment and one is a real word. */
function isPathLike(path: string): boolean {
  const segments = path.split(/[?#]/u, 1)[0]!.split('/').filter(Boolean);
  return segments.length > 0
    && segments.every((segment) => /^[A-Za-z0-9_.~-]+$/u.test(segment))
    && segments.some((segment) => /[A-Za-z]{2,}/u.test(segment));
}

/**
 * Returns a path only with an explicit cue: a GET/HEAD/path label, a leading-slash
 * path, or a bare `a/b` path accompanied by an HTTP/API/URL cue. Ordinary text such
 * as "I/O" or "A/B 테스트" is never treated as a path.
 */
export function explicitHttpPath(message: string): string | undefined {
  const labeled = [
    /(?:GET|HEAD|겟)\s*(?:경로|path)\s*(?:를)?[^:\n]{0,100}[:：]\s*([^\s"'`<>]+)/iu,
    /(?:^|[\s(])(?:GET|HEAD|겟)\s+([^\s"'`<>]+)/iu,
    /(?:경로|path)\s*[:：]\s*([^\s"'`<>]+)/iu,
  ];
  for (const pattern of labeled) {
    const path = normalizeHttpPath(message.match(pattern)?.[1]);
    if (path) return path;
  }
  const slashPath = normalizeHttpPath(message.match(LEADING_SLASH_PATH)?.[1]);
  if (slashPath && isPathLike(slashPath)) return slashPath;
  if (!HTTP_REQUEST_CUE.test(message)) return undefined;
  const barePath = normalizeHttpPath(message.match(BARE_SEGMENTED_PATH)?.[1]);
  return barePath && isPathLike(barePath) ? barePath : undefined;
}

function endpointMentioned(message: string, value: string | undefined): boolean {
  const needle = value?.trim();
  if (!needle) return false;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[^A-Za-z0-9_])${escaped}(?:$|[^A-Za-z0-9_])`, 'iu').test(message);
}

const HTTP_WORDS = /https?:\/\/|\b(?:https?|api|rest|post|put|patch|webhook|endpoint|url)\b|웹훅|엔드포인트/iu;
// A Slack channel ("#ops", "운영 채널") or a mail address: the request already names where it goes.
const OTHER_DESTINATION = /(?:^|[\s(])#[\p{L}\p{N}_.-]+|[\p{L}\p{N}_.-]+\s*채널|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu;
const PARTICLE = '(?:에서|에게|으로|로|에|을|를|은|는|이|가|의|와|과)?';

/** An endpoint name used as a word of its own: "테스트에 등록해줘" names "테스트", "ax테스트" does not. */
function endpointNamedAsWord(message: string, value: string | undefined): boolean {
  const needle = value?.trim();
  if (!needle || needle.length < 2) return false;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}${PARTICLE}(?![\\p{L}\\p{N}_])`, 'iu').test(message);
}

/**
 * Whether the request is about an HTTP call at all: it says HTTP/API/URL-like words, or names a
 * connected endpoint while naming no other destination. An HTTP write sends data to whatever
 * address a connection points at, so it is offered only then. Real use: an endpoint called
 * "테스트" turned "ax테스트 채널에 '… 테스트 메시지' 보내줘" into a Slack send plus an HTTP POST.
 */
export function requestMentionsHttp(message: string, endpoints: readonly JevHttpEndpointHint[] = []): boolean {
  if (HTTP_WORDS.test(message) || hasExplicitHttpEndpointCue(message)) return true;
  if (OTHER_DESTINATION.test(message)) return false;
  return endpoints.some((endpoint) => endpointNamedAsWord(message, endpoint.label) || endpointNamedAsWord(message, endpoint.id));
}

export function hasExplicitHttpEndpointCue(message: string): boolean {
  const patterns = [
    /^\s*([A-Za-z][A-Za-z0-9._-]{1,80})\s+(?:GET|HEAD)\b/iu,
    /(?:^|\s)([A-Za-z][A-Za-z0-9._-]{1,80})\s*(?:API|endpoint|연결|에서)(?=\s|$|[/?.,!])/iu,
    /(?:HTTP\s+연결\s+ID|connection\s+id)\s+([A-Za-z0-9][A-Za-z0-9._-]{0,80})/iu,
  ];
  const generic = new Set(['api', 'http', 'rest', 'endpoint']);
  return patterns.some((pattern) => {
    const candidate = message.match(pattern)?.[1]?.toLowerCase();
    return Boolean(candidate && !generic.has(candidate));
  });
}

function endpointMatchesMessage(message: string, endpoint: JevHttpEndpointHint): boolean {
  return [endpoint.id, endpoint.label].some((value) => endpointMentioned(message, value));
}

/** Select only a uniquely evidenced, usable endpoint; never guess among connections. */
export function selectHttpEndpointForRead(
  message: string,
  endpoints: readonly JevHttpEndpointHint[],
): JevHttpEndpointHint | undefined {
  const usable = endpoints.filter((endpoint) => endpoint.usable !== false);
  const mentioned = usable.filter((endpoint) => endpointMatchesMessage(message, endpoint));
  if (mentioned.length > 0) return mentioned.length === 1 ? mentioned[0] : undefined;
  if (hasExplicitHttpEndpointCue(message)) return undefined;
  return usable.length === 1 ? usable[0] : undefined;
}
