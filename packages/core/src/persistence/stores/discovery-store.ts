import type { AppDatabase } from '../db.js';
import type { TableArtifact } from '../../contracts/artifacts/table.js';
import type { DiscoverySessionState } from '../../work-discovery/schema.js';
import * as discoveryRepo from '../repositories/work-discovery-repository.js';
import type { DiscoveryMetadataInput, DiscoveryMetadataRecord } from '../../contracts/discovery-metadata.js';
import * as discoveryMetadata from '../repositories/discovery-metadata-repository.js';

export class DiscoveryStore {
  private discoveryMetadataRevision = 0;

  constructor(private readonly db: AppDatabase) {}

  getDiscoveryMetadata(assetId: string): DiscoveryMetadataRecord | undefined {
    return discoveryMetadata.getDiscoveryMetadata(this.db, assetId);
  }
  listDiscoveryMetadata(): DiscoveryMetadataRecord[] {
    return discoveryMetadata.listDiscoveryMetadata(this.db);
  }
  upsertDiscoveryMetadata(input: DiscoveryMetadataInput): DiscoveryMetadataRecord {
    const saved = discoveryMetadata.upsertDiscoveryMetadata(this.db, input);
    this.discoveryMetadataRevision++;
    return saved;
  }
  deleteDiscoveryMetadata(assetId: string): boolean {
    const removed = discoveryMetadata.deleteDiscoveryMetadata(this.db, assetId);
    if (removed) this.discoveryMetadataRevision++;
    return removed;
  }
  getDiscoveryMetadataRevision() { return this.discoveryMetadataRevision; }

  /** Pass `expectedRevision` (the revision the caller read) for a strict compare-and-swap. */
  saveDiscoverySession(state: DiscoverySessionState, expectedRevision?: number) {
    // Existence only: a corrupt stored state must still be overwritable by a valid one.
    if (this.db.prepare('SELECT 1 FROM work_discovery_sessions WHERE id = ?').get(state.id)) {
      discoveryRepo.updateDiscoverySession(this.db, state, expectedRevision);
      return;
    }
    discoveryRepo.insertDiscoverySession(this.db, state);
  }
  getDiscoverySessionState(id: string) { return discoveryRepo.getDiscoverySession(this.db, id); }
  bindDiscoverySessionWorkspace(sessionId: string, workspaceSessionId: string) {
    discoveryRepo.bindDiscoverySessionWorkspace(this.db, sessionId, workspaceSessionId);
  }
  getDiscoverySessionWorkspace(sessionId: string) { return discoveryRepo.getDiscoverySessionWorkspace(this.db, sessionId); }
  listDiscoverySessions() { return discoveryRepo.listDiscoverySessions(this.db); }
  listDiscoverySessionIds() { return discoveryRepo.listDiscoverySessionIds(this.db); }
  insertDiscoveryExample(params: {
    sessionId: string;
    label?: string;
    outputArtifactIds: string[];
    inputArtifactIds: string[];
    observationsJson?: string;
  }) {
    return discoveryRepo.insertDiscoveryExample(this.db, params);
  }
  listDiscoveryExamples(sessionId: string) { return discoveryRepo.listDiscoveryExamples(this.db, sessionId); }
  insertDiscoverySnapshot(snapshot: discoveryRepo.DiscoverySnapshotRecord & { table?: TableArtifact }) {
    const { table: _table, ...record } = snapshot;
    return discoveryRepo.insertDiscoverySnapshot(this.db, record);
  }
  upsertDiscoverySnapshot(snapshot: discoveryRepo.DiscoverySnapshotRecord & { table?: TableArtifact }) {
    const { table: _table, ...record } = snapshot;
    return discoveryRepo.upsertDiscoverySnapshot(this.db, record);
  }
  listDiscoverySnapshots(sessionId: string) {
    return discoveryRepo.listDiscoverySnapshots(this.db, sessionId);
  }
  upsertDiscoveryReplayCase(replayCase: discoveryRepo.DiscoveryReplayCaseRecord) {
    return discoveryRepo.upsertDiscoveryReplayCase(this.db, replayCase);
  }
  listDiscoveryReplayCases(sessionId: string) {
    return discoveryRepo.listDiscoveryReplayCases(this.db, sessionId);
  }
}
