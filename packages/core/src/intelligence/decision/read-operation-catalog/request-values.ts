import type { OpenApiParameter } from '../../../connectors/protocols/openapi/index.js';
import { requestLimitCandidates } from '../request-limit.js';
import type { JevReadParameterHint } from './types.js';

export const MAX_TEXT_CHARS = 320;
export const MAX_EXPLICIT_PARAMETER_CHARS = 500;
const NATURAL_LIMIT_PARAMETER_NAMES = new Set([
  'count',
  'limit',
  'pagesize',
  'perpage',
  'per_page',
  'size',
  'top',
]);
export const SENSITIVE_PARAMETER_NAME = /(?:api[_-]?key|authorization|password|secret|token)/iu;

export function text(value: unknown, maxChars = MAX_TEXT_CHARS): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxChars) : undefined;
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function explicitParameterValue(message: string, name: string): string | undefined {
  const pattern = new RegExp(`(?:^|[?&\\s])${escapeRegExp(name)}\\s*[=:]\\s*([^\\s&"'<>]+)`, 'iu');
  const value = message.match(pattern)?.[1];
  if (!value || value.length > MAX_EXPLICIT_PARAMETER_CHARS) return undefined;
  return value.replace(/^([A-Za-z0-9][A-Za-z0-9._:-]*)(?:으로|에서|에게|을|를|이|가|은|는|와|과|로|에)$/u, '$1');
}

export function parameterValue(message: string, parameter: OpenApiParameter): string | number | boolean | undefined {
  if (parameter.in === 'header' || parameter.in === 'cookie' || SENSITIVE_PARAMETER_NAME.test(parameter.name)) {
    return undefined;
  }
  const raw = explicitParameterValue(message, parameter.name);
  if (raw === undefined) return undefined;
  let value: string | number | boolean | undefined;
  if (parameter.type === 'integer' || parameter.type === 'number') {
    const numeric = Number(raw);
    value = Number.isFinite(numeric) && (parameter.type !== 'integer' || Number.isInteger(numeric))
      ? numeric
      : undefined;
  } else if (parameter.type === 'boolean') {
    value = /^(?:true|yes|예|맞아)$/iu.test(raw)
      ? true
      : /^(?:false|no|아니)$/iu.test(raw) ? false : undefined;
  } else {
    value = raw;
  }
  return value !== undefined && parameter.enum && !parameter.enum.includes(value) ? undefined : value;
}

/** An explicit `limit=` the request typed, parsed as an integer query value. */
export function explicitLimit(message: string): string | number | boolean | undefined {
  return parameterValue(message, { name: 'limit', in: 'query', required: false, type: 'integer' });
}

function isTopNLimitCandidate(value: number, message: string): boolean {
  const pattern = new RegExp(
    `(?:` +
      `(?:제일|가장|최저|최고|상위|하위)\\s*(?:\\S+\\s*)?${value}\\s*(?:개|건|명|개만|항목)?` +
      `|` +
      `(?:적은|많은|높은|낮은|비싼|저렴한|싼|큰|작은)\\s*(?:것|거|상품|항목|데이터)?\\s*${value}\\s*(?:개|건|명|개만|항목)?` +
      `|` +
      `${value}\\s*(?:개|건|명)?\\s*(?:제일|가장|최저|최고)` +
      `|` +
      `\\b(?:top|bottom)\\s*${value}\\b` +
      `|` +
      `순(?:으로)?\\s*${value}\\s*(?:개|건|명|항목)?` +
    `)`,
    'iu',
  );
  return pattern.test(message);
}

export function naturalLimitChoices(name: string, type: string | undefined, message: string): readonly number[] | undefined {
  if (!NATURAL_LIMIT_PARAMETER_NAMES.has(name.toLowerCase()) || !['integer', 'number'].includes(type ?? '')) {
    return undefined;
  }
  const choices = requestLimitCandidates(message).filter((value) =>
    (type !== 'integer' || Number.isInteger(value)) && !isTopNLimitCandidate(value, message),
  );
  return choices.length > 0 ? choices : undefined;
}

/** The optional integer limit a bounded read offers, with request-stated counts as Jev choices. */
export function limitParameterHint(path: string, userMessage: string, description?: string): JevReadParameterHint {
  const choices = naturalLimitChoices('limit', 'integer', userMessage);
  return {
    path,
    type: 'integer',
    ...(description ? { description } : {}),
    required: false,
    ...(choices ? { choices } : {}),
  };
}

export function isSearchParameter(name: string): boolean {
  return /^(?:q|query|search|search[_-]?term|keyword|keywords)$/iu.test(name);
}

export function explicitSearchQuery(message: string): string | undefined {
  const labeled = ['query', 'q', '검색어', '검색조건', '검색 조건']
    .map((name) => explicitParameterValue(message, name))
    .find((value): value is string => Boolean(value));
  if (labeled) return labeled.slice(0, MAX_EXPLICIT_PARAMETER_CHARS);
  const quoted = message.match(/(?:query|q|검색어|검색\s*조건)\s*[:：=]\s*["']([^"'\n]{1,500})["']/iu)?.[1]?.trim();
  if (quoted) return quoted.slice(0, MAX_EXPLICIT_PARAMETER_CHARS);
  const word = message.match(/([\p{L}\p{N}_-]{2,}?)(?:라는)?\s*단어/iu)?.[1]?.trim();
  if (word) return word.slice(0, MAX_EXPLICIT_PARAMETER_CHARS);
  const related = message.match(/(?:^|\s)([\p{L}\p{N}_-]{2,})\s*(?:관련(?:된)?|에\s*대한|포함(?:된)?|언급(?:된)?|about|related\s+to)/iu)?.[1]?.trim();
  return related?.slice(0, MAX_EXPLICIT_PARAMETER_CHARS);
}
