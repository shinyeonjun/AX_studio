import { describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../../store/db.js';
import { WorkflowStore } from '../../store/workflow-store.js';
import { rdbDiscoverySource } from './discovery-source.js';
import { createSqliteCustomersFixture } from './sqlite-test-fixture.js';

describe('rdbDiscoverySource', () => {
  it('preserves schema columns and truncation metadata in source snapshots', async () => {
    const fixture = await createSqliteCustomersFixture();
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    store.setConnection('rdb', true, {
      type: 'sqlite',
      filePath: fixture.filePath,
      allowedTables: ['customers'],
      rowLimit: 1,
    });

    try {
      const profile = await rdbDiscoverySource.profileSource({
        store,
        artifactStore: {} as never,
        snapshotDir: 'unused',
        exampleId: 'example-1',
        observations: [],
        inputArtifactIds: [],
        budget: { sourceReadsUsed: 0, sourceReadsMax: 1 },
      }, 'rdb:customers');

      expect(profile?.table).toMatchObject({
        columns: [
          { name: 'id' },
          { name: 'name' },
          { name: 'priority' },
        ],
        rows: [{ values: { id: 1, name: 'AsterTech', priority: 'critical' } }],
        truncated: true,
        completeness: { status: 'partial', reason: 'row_limit', observedCount: 1, limit: 1, hasMore: true },
        source: { queryFingerprint: expect.any(String), capturedAt: expect.any(String) },
      });
    } finally {
      db.close();
      fixture.cleanup();
    }
  });
});
