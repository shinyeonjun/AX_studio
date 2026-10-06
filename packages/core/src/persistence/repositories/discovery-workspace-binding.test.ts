import { describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../db.js';
import { applyMigrations, LATEST_SCHEMA_VERSION, readSchemaVersion, SCHEMA_MIGRATIONS } from '../db/schema.js';
import { WorkflowStore } from '../workflow-store.js';
import { makeSession } from '../../work-discovery/service/fixtures.js';

describe('discovery session workspace owner', () => {
  it('stores the first owner only and reads it back', async () => {
    const db = await createDatabaseAsync(':memory:');
    try {
      const store = new WorkflowStore(db);
      store.saveDiscoverySession(makeSession('wd_owner'));
      expect(store.getDiscoverySessionWorkspace('wd_owner')).toBeUndefined();
      store.bindDiscoverySessionWorkspace('wd_owner', 'chat-a');
      store.bindDiscoverySessionWorkspace('wd_owner', 'chat-b');
      expect(store.getDiscoverySessionWorkspace('wd_owner')).toBe('chat-a');
      expect(store.getDiscoverySessionWorkspace('wd_missing')).toBeUndefined();
    } finally { db.close?.(); }
  });

  it('migration 3 is idempotent when the column already exists', async () => {
    const db = await createDatabaseAsync(':memory:');
    try {
      const migration = SCHEMA_MIGRATIONS.find((entry) => entry.version === 3)!;
      expect(() => migration.up(db)).not.toThrow();
      db.exec('PRAGMA user_version = 2');
      applyMigrations(db);
      expect(readSchemaVersion(db)).toBe(LATEST_SCHEMA_VERSION);
      const columns = db.prepare('PRAGMA table_info(work_discovery_sessions)').all() as Array<{ name: string }>;
      expect(columns.filter((column) => column.name === 'workspace_session_id')).toHaveLength(1);
    } finally { db.close?.(); }
  });
});
