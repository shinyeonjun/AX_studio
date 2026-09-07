import type { AppDatabase } from '../db.js';
import type { TableArtifact } from '../../contracts/artifacts/table.js';
import type { DiscoverySessionState } from '../../work-discovery/schema.js';
import * as discoveryRepo from '../repositories/work-discovery-repository.js';

export function saveDiscoverySession(db: AppDatabase, state: DiscoverySessionState) {
  const existing = discoveryRepo.getDiscoverySession(db, state.id);
  if (existing) {
    discoveryRepo.updateDiscoverySession(db, state);
    return;
  }
  discoveryRepo.insertDiscoverySession(db, state);
}

export function getDiscoverySessionState(db: AppDatabase, id: string) {
  return discoveryRepo.getDiscoverySession(db, id);
}

export function listDiscoverySessions(db: AppDatabase) {
  return discoveryRepo.listDiscoverySessions(db);
}

export function insertDiscoveryExample(
  db: AppDatabase,
  params: {
    sessionId: string;
    label?: string;
    outputArtifactIds: string[];
    inputArtifactIds: string[];
    observationsJson?: string;
  },
) {
  return discoveryRepo.insertDiscoveryExample(db, params);
}

export function listDiscoveryExamples(db: AppDatabase, sessionId: string) {
  return discoveryRepo.listDiscoveryExamples(db, sessionId);
}

export function insertDiscoverySnapshot(
  db: AppDatabase,
  snapshot: discoveryRepo.DiscoverySnapshotRecord & { table?: TableArtifact },
) {
  const { table: _table, ...record } = snapshot;
  return discoveryRepo.insertDiscoverySnapshot(db, record);
}

export function upsertDiscoverySnapshot(
  db: AppDatabase,
  snapshot: discoveryRepo.DiscoverySnapshotRecord & { table?: TableArtifact },
) {
  const { table: _table, ...record } = snapshot;
  return discoveryRepo.upsertDiscoverySnapshot(db, record);
}

export function listDiscoverySnapshots(db: AppDatabase, sessionId: string) {
  return discoveryRepo.listDiscoverySnapshots(db, sessionId);
}

export function upsertDiscoveryReplayCase(
  db: AppDatabase,
  replayCase: discoveryRepo.DiscoveryReplayCaseRecord,
) {
  return discoveryRepo.upsertDiscoveryReplayCase(db, replayCase);
}

export function listDiscoveryReplayCases(db: AppDatabase, sessionId: string) {
  return discoveryRepo.listDiscoveryReplayCases(db, sessionId);
}
