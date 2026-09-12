import { describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../../persistence/db.js';
import { WorkflowStore } from '../../persistence/workflow-store.js';
import type { DiscoverySourceContext } from '../../contracts/discovery-source.js';
import { rdbDiscoverySource } from './discovery-source.js';
import { createSqliteCustomersFixture } from './sqlite-test-fixture.js';

describe('RDB discovery read budget and identity', () => {
  it('reserves the shared read budget before concurrent reads and rejects another source namespace', async () => {
    const fixture = await createSqliteCustomersFixture();
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    store.setConnection('rdb', true, { type: 'sqlite', filePath: fixture.filePath, allowedTables: ['customers'] });
    const ctx: DiscoverySourceContext = {
      store, artifactStore: {} as never, snapshotDir: 'unused', exampleId: 'example',
      observations: [], inputArtifactIds: [], budget: { sourceReadsUsed: 0, sourceReadsMax: 1 },
    };
    try {
      const profiles = await Promise.all([
        rdbDiscoverySource.profileSource(ctx, 'rdb:customers'),
        rdbDiscoverySource.profileSource(ctx, 'rdb:customers'),
      ]);
      expect(profiles.filter(Boolean)).toHaveLength(1);
      expect(ctx.budget.sourceReadsUsed).toBe(1);
    } finally { db.close?.(); fixture.cleanup(); }
  });

  it('does not profile an unqualified source ID', async () => {
    const fixture = await createSqliteCustomersFixture();
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    store.setConnection('rdb', true, { type: 'sqlite', filePath: fixture.filePath, allowedTables: ['customers'] });
    const ctx: DiscoverySourceContext = {
      store, artifactStore: {} as never, snapshotDir: 'unused', exampleId: 'example',
      observations: [], inputArtifactIds: [], budget: { sourceReadsUsed: 0, sourceReadsMax: 1 },
    };
    try {
      expect(await rdbDiscoverySource.profileSource(ctx, 'customers')).toBeNull();
      expect(ctx.budget.sourceReadsUsed).toBe(0);
    } finally { db.close?.(); fixture.cleanup(); }
  });
});
