import { createHash } from 'node:crypto';

const SENSITIVE_KEY = /(?:token|secret|password|authorization|cookie|api[-_]?key|credential|private[-_]?key)/iu;
const MAX_SNAPSHOT_KEYS = 64;
const MAX_SNAPSHOT_ITEMS = 64;
const MAX_SNAPSHOT_STRING = 500;

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry)]),
  );
}

export function approvalParamsHash(params: Record<string, unknown>): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(params)))
    .digest('hex');
}

function redact(value: unknown, key?: string, depth = 0): unknown {
  if (key && SENSITIVE_KEY.test(key)) return '[redacted]';
  if (typeof value === 'string') {
    return value.length > MAX_SNAPSHOT_STRING ? `${value.slice(0, MAX_SNAPSHOT_STRING)}…` : value;
  }
  if (value === null || typeof value !== 'object' || depth >= 4) return value;
  if (Array.isArray(value)) return value.slice(0, MAX_SNAPSHOT_ITEMS).map((item) => redact(item, undefined, depth + 1));
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .slice(0, MAX_SNAPSHOT_KEYS)
      .map(([entryKey, entry]) => [entryKey, redact(entry, entryKey, depth + 1)]),
  );
}

export function redactedApprovalParams(params: Record<string, unknown>): Record<string, unknown> {
  return redact(params) as Record<string, unknown>;
}
