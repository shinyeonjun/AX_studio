import { describe, expect, it } from 'vitest';
import { createDatabaseAsync } from './db.js';
import { WorkflowStore } from './workflow-store.js';

describe('WorkflowStore connection revision', () => {
  it('increments after every persisted connection update', async () => {
    const db = await createDatabaseAsync(':memory:');
    try {
      const store = new WorkflowStore(db);
      expect(store.getConnectionRevision()).toBe(0);
      store.setConnection('openapi', true, { specId: 'catalog' });
      expect(store.getConnectionRevision()).toBe(1);
      store.setConnection('openapi', false);
      expect(store.getConnectionRevision()).toBe(2);
    } finally {
      db.close?.();
    }
  });
});
