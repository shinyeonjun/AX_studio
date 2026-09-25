import { describe, expect, it, vi } from 'vitest';
import { createDatabaseAsync } from '../../../../../persistence/db.js';
import { WorkflowStore } from '../../../../../persistence/workflow-store.js';
import { AxCommandService } from '../../service.js';

describe('AxCommandService resource list', () => {
  it('reads and parses persisted connections once, including HTTP endpoints', async () => {
    const db = await createDatabaseAsync(':memory:');
    try {
      const store = new WorkflowStore(db);
      store.setConnection('http', true, {
        endpoints: [{ id: 'catalog', label: 'Catalog', baseUrl: 'https://api.example.test/v1' }],
      });
      const getConnections = vi.spyOn(store, 'getConnections');
      const response = await new AxCommandService(store).execute({ name: 'resource.list' });

      expect(getConnections).toHaveBeenCalledTimes(1);
      expect(response.data).toMatchObject({
        resources: expect.arrayContaining([
          expect.objectContaining({
            id: 'http',
            connected: true,
            endpoints: [expect.objectContaining({ id: 'catalog', label: 'Catalog' })],
          }),
        ]),
      });
    } finally {
      db.close?.();
    }
  });
});
