import { createHash } from 'node:crypto';
import type { ConnectorContext } from '../../connectors/types.js';

const REPORT_IDENTITY_CONNECTORS = new Set(['http', 'openapi', 'rdb']);
const VOLATILE_CONNECTION_KEYS = new Set(['connectedAt', 'lastError']);
const SENSITIVE_CONNECTION_KEY = /(?:token|password|secret|authorization|api[-_]?key|connectionstring|private[-_]?key)/iu;

function compareIdentityValues(left: unknown, right: unknown): number {
  const leftJson = JSON.stringify(left);
  const rightJson = JSON.stringify(right);
  return leftJson < rightJson ? -1 : leftJson > rightJson ? 1 : 0;
}

function reportIdentityValue(value: unknown, key?: string): unknown {
  if (key && VOLATILE_CONNECTION_KEYS.has(key)) return undefined;
  if (key && SENSITIVE_CONNECTION_KEY.test(key)) {
    return { sha256: createHash('sha256').update(JSON.stringify(value) ?? 'undefined').digest('hex') };
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => reportIdentityValue(item))
      .filter((item): item is unknown => item !== undefined);
  }
  if (!value || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  const normalized: Record<string, unknown> = {};
  for (const entry of Object.keys(record).sort()) {
    const normalizedValue = reportIdentityValue(record[entry], entry);
    if (normalizedValue !== undefined) normalized[entry] = normalizedValue;
  }
  return normalized;
}

/**
 * Report checkpoints depend on source availability and authorization shape,
 * not on connection health timestamps or unrelated connector metadata. Secret
 * values still participate through a one-way fingerprint so changing the
 * target or credentials cannot silently reuse evidence from another source.
 */
export function reportConnectionIdentity(
  connections: ConnectorContext['connections'],
): unknown[] {
  return (connections ?? [])
    .filter((connection) => REPORT_IDENTITY_CONNECTORS.has(connection.connector))
    .map((connection) => ({
      connector: connection.connector,
      connected: connection.connected,
      config: reportIdentityValue(connection.config),
    }))
    .sort(compareIdentityValues);
}
