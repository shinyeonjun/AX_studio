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

/** A display field shortened for the approval snapshot; the hash still covers the full value. */
export interface ApprovalSnapshotTruncation {
  path: string;
  /** Original string length, array item count, or object key count. */
  originalLength: number;
}

function redact(value: unknown, truncations: ApprovalSnapshotTruncation[], path: string, key?: string, depth = 0): unknown {
  if (key && SENSITIVE_KEY.test(key)) return '[redacted]';
  if (typeof value === 'string') {
    if (value.length <= MAX_SNAPSHOT_STRING) return value;
    truncations.push({ path, originalLength: value.length });
    return `${value.slice(0, MAX_SNAPSHOT_STRING)}…`;
  }
  if (value === null || typeof value !== 'object' || depth >= 4) return value;
  if (Array.isArray(value)) {
    if (value.length > MAX_SNAPSHOT_ITEMS) truncations.push({ path, originalLength: value.length });
    return value.slice(0, MAX_SNAPSHOT_ITEMS).map((item, index) => redact(item, truncations, `${path}[${index}]`, undefined, depth + 1));
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > MAX_SNAPSHOT_KEYS) truncations.push({ path, originalLength: entries.length });
  return Object.fromEntries(
    entries
      .slice(0, MAX_SNAPSHOT_KEYS)
      .map(([entryKey, entry]) => [entryKey, redact(entry, truncations, path ? `${path}.${entryKey}` : entryKey, entryKey, depth + 1)]),
  );
}

export function redactedApprovalParams(params: Record<string, unknown>): Record<string, unknown> {
  return redactedApprovalSnapshot(params).params;
}

/**
 * Display copy of approval params. Shortened fields are reported explicitly so a
 * reviewer is never shown a silently cut payload while paramsHash covers all of it.
 */
export function redactedApprovalSnapshot(params: Record<string, unknown>): {
  params: Record<string, unknown>;
  truncated?: true;
  truncatedFields?: ApprovalSnapshotTruncation[];
} {
  const truncations: ApprovalSnapshotTruncation[] = [];
  const redacted = redact(params, truncations, '') as Record<string, unknown>;
  return truncations.length > 0
    ? { params: redacted, truncated: true, truncatedFields: truncations }
    : { params: redacted };
}
