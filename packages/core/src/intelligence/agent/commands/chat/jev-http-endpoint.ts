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

export function explicitHttpPath(message: string): string | undefined {
  const patterns = [
    /(?:GET|HEAD|겟)\s*(?:경로|path)\s*(?:를)?[^:\n]{0,100}[:：]\s*([^\s"'`<>]+)/iu,
    /(?:^|[\s(])(?:GET|HEAD|겟)\s+([^\s"'`<>]+)/iu,
    /(?:경로|path)\s*[:：]\s*([^\s"'`<>]+)/iu,
  ];
  for (const pattern of patterns) {
    const path = normalizeHttpPath(message.match(pattern)?.[1]);
    if (path) return path;
  }
  return undefined;
}

function endpointMentioned(message: string, value: string | undefined): boolean {
  const needle = value?.trim();
  if (!needle) return false;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[^A-Za-z0-9_])${escaped}(?:$|[^A-Za-z0-9_])`, 'iu').test(message);
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
