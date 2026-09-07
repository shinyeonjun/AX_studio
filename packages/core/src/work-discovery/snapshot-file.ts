import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TableArtifact } from '../contracts/artifacts/table.js';

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function writeSnapshotTable(root: string, exampleId: string, sourceId: string,
  table: TableArtifact, fingerprint: string): string {
  const payload = { exampleId, sourceId, fingerprint, table };
  const hash = digest(payload);
  const path = join(root, `snapshot-v1-${hash}.json`);
  const serialized = JSON.stringify({ snapshotVersion: 1, digest: hash, payload });
  mkdirSync(root, { recursive: true });
  try { writeFileSync(path, serialized, { flag: 'wx' }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || readFileSync(path, 'utf8') !== serialized) throw error;
  }
  return path;
}

export function unwrapSnapshotTable(raw: unknown, exampleId: string, sourceId: string, fingerprint: string): unknown {
  if (!raw || typeof raw !== 'object' || !('snapshotVersion' in raw)) return raw; // legacy standalone table
  const envelope = raw as { snapshotVersion: unknown; digest?: unknown; payload?: unknown };
  if (envelope.snapshotVersion !== 1 || !envelope.payload || typeof envelope.payload !== 'object') return undefined;
  const payload = envelope.payload as Record<string, unknown>;
  if (digest(payload) !== envelope.digest || payload.exampleId !== exampleId || payload.sourceId !== sourceId
      || payload.fingerprint !== fingerprint) return undefined;
  return payload.table;
}
