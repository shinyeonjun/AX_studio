import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import type { WorkflowStore } from '../store/workflow-store.js';
import { TableArtifactSchema, type TableArtifact } from '../contracts/artifacts/table.js';
import type { DiscoverySessionState } from './schema.js';

export function loadPersistedSnapshotTables(
  store: WorkflowStore,
  state: DiscoverySessionState,
  exampleIds: string[],
): Record<string, Record<string, TableArtifact>> | undefined {
  if (state.sourceInventory.length === 0 || exampleIds.length === 0) return undefined;
  const records = store.listDiscoverySnapshots(state.id);
  if (records.length === 0) return undefined;
  const snapshotsByExample: Record<string, Record<string, TableArtifact>> = {};

  for (const record of records) {
    if (!record.manifestPath || !existsSync(record.manifestPath)) return undefined;
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(record.manifestPath, 'utf8')) as unknown;
    } catch {
      return undefined;
    }
    const parsed = TableArtifactSchema.safeParse(raw);
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
