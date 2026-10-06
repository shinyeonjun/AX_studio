import { describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../db.js';
import { WorkflowStore } from '../workflow-store.js';
import type { DiscoverySessionState } from '../../work-discovery/schema.js';

function session(revision: number): DiscoverySessionState {
  const now = new Date().toISOString();
  return {
    id: 'wd_revision', status: 'collecting_examples', revision, userGoal: 'goal', exampleIds: [],
    sourceInventory: [], observations: [], candidates: [],
    budgets: { sourceReadsUsed: 0, sourceReadsMax: 12, elapsedMs: 0 }, createdAt: now, updatedAt: now,
  };
}

describe('discovery session optimistic concurrency', () => {
  it('applies a compare-and-swap write only against the expected revision', async () => {
    const db = await createDatabaseAsync(':memory:');
    try {
      const store = new WorkflowStore(db);
      store.saveDiscoverySession(session(1));
      store.saveDiscoverySession(session(2), 1);
      expect(store.getDiscoverySessionState('wd_revision')?.revision).toBe(2);

      expect(() => store.saveDiscoverySession(session(2), 1)).toThrowError(expect.objectContaining({
        code: 'discovery_revision_conflict', expectedRevision: 1, currentRevision: 2,
      }));
    } finally { db.close?.(); }
  });

  it('never lets an unguarded stale write move the revision backwards', async () => {
    const db = await createDatabaseAsync(':memory:');
    try {
      const store = new WorkflowStore(db);
      store.saveDiscoverySession(session(3));
      store.saveDiscoverySession(session(3)); // same-revision resave stays allowed
      expect(() => store.saveDiscoverySession(session(2))).toThrowError(expect.objectContaining({
        code: 'discovery_revision_conflict', currentRevision: 3,
      }));
      expect(store.getDiscoverySessionState('wd_revision')?.revision).toBe(3);
    } finally { db.close?.(); }
  });

  it('overwrites a corrupt stored state with a valid one', async () => {
    const db = await createDatabaseAsync(':memory:');
    try {
      const store = new WorkflowStore(db);
      store.saveDiscoverySession(session(1));
      db.prepare("UPDATE work_discovery_sessions SET state_json = '{' WHERE id = 'wd_revision'").run();
      store.saveDiscoverySession(session(2));
      expect(store.getDiscoverySessionState('wd_revision')?.revision).toBe(2);
    } finally { db.close?.(); }
  });
});
