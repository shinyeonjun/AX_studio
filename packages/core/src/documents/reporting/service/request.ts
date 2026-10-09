import { createReadStream } from 'node:fs';
import {
  MAX_FILE_NAME_UTF8_BYTES,
  truncateToUtf8Bytes,
} from '../../../platform/file-name-bytes.js';
import { basename } from 'node:path';
import type { ConnectorContext } from '../../../connectors/types.js';
import { createHash } from 'node:crypto';

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

export async function fileDigest(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
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

interface ReportGenerateParams {
  goal: string;
  /** The blank form. Absent when only a completed report was given; the form is then derived. */
  templateSourceId?: string;
  exampleSourceId: string;
  resumeExecutionId?: string;
}

export function parseParams(params: Record<string, unknown>): ReportGenerateParams {
  const goal = typeof params.goal === 'string' ? params.goal.trim() : '';
  const templateSourceId = typeof params.templateSourceId === 'string' ? params.templateSourceId.trim() : '';
  const exampleSourceId = typeof params.exampleSourceId === 'string' ? params.exampleSourceId.trim() : '';
  if (!goal) throw new Error('report_goal_required');
  if (!exampleSourceId) throw new Error('report_example_source_required');
  if (templateSourceId === exampleSourceId) throw new Error('report_sources_must_differ');
  const resumeExecutionId = typeof params.resumeExecutionId === 'string' ? params.resumeExecutionId.trim() : undefined;
  if (resumeExecutionId && resumeExecutionId.length > 160) throw new Error('report_resume_id_invalid');
  return { goal, ...(templateSourceId ? { templateSourceId } : {}), exampleSourceId, ...(resumeExecutionId ? { resumeExecutionId } : {}) };
}

const MAX_REPORT_BASE_NAME_CHARS = 120;

export function safePdfFileName(value: string): string {
  const name = basename(value.normalize('NFC')).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim();
  // Windows rejects trailing dots/spaces; long names would also exceed MAX_PATH downstream.
  const base = truncateToUtf8Bytes(Array.from(name.replace(/\.pdf$/i, '')).slice(0, MAX_REPORT_BASE_NAME_CHARS).join(''),
    MAX_FILE_NAME_UTF8_BYTES - 4).replace(/[.\s]+$/, '');
  if (!base) return 'generated-report.pdf';
  return `${base}.pdf`;
}
