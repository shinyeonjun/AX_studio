import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import type { WorkflowStore } from '../persistence/workflow-store.js';
import { TableArtifactSchema, type TableArtifact } from '../contracts/artifacts/table.js';
import type { DiscoverySessionState } from './schema.js';
import { unwrapSnapshotTable } from './snapshot-file.js';

export function loadPersistedSnapshotTables(
  store: WorkflowStore,
  state: DiscoverySessionState,
  exampleIds: string[],
): Record<string, Record<string, TableArtifact>> | undefined {
  if (state.sourceInventory.length === 0 || exampleIds.length === 0) return undefined;
  const records = store.listDiscoverySnapshots(state.id);
  if (records.length === 0) return undefined;
  // Legacy captures sharing one physical file cannot establish isolated evidence.
  const owners = new Map<string, string>();
  for (const record of records) {
    if (!record.manifestPath) return undefined;
    const owner = `${record.exampleId}\0${record.sourceId}`;
    if (owners.has(record.manifestPath) && owners.get(record.manifestPath) !== owner) return undefined;
    owners.set(record.manifestPath, owner);
  }
  const snapshotsByExample: Record<string, Record<string, TableArtifact>> = {};

  for (const record of records) {
    if (!record.manifestPath || !existsSync(record.manifestPath)) return undefined;
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(record.manifestPath, 'utf8')) as unknown;
    } catch {
      return undefined;
    }
    const parsed = TableArtifactSchema.safeParse(unwrapSnapshotTable(raw, record.exampleId, record.sourceId, record.fingerprint));
    if (!parsed.success) return undefined;
    snapshotsByExample[record.exampleId] ??= {};
    snapshotsByExample[record.exampleId]![record.sourceId] = parsed.data;
  }

  const hasAllSourceSnapshots = exampleIds.every((exampleId) => {
    const snapshots = snapshotsByExample[exampleId];
    return state.sourceInventory.every((source) => Boolean(snapshots?.[source.id]));
  });
  return hasAllSourceSnapshots ? snapshotsByExample : undefined;
}

export function snapshotRecordId(sessionId: string, exampleId: string, sourceId: string): string {
  return `snap_${createHash('sha256')
    .update(`${sessionId}\0${exampleId}\0${sourceId}`)
    .digest('hex')
    .slice(0, 24)}`;
}
