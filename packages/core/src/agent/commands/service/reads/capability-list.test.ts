import { describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../../../../store/db.js';
import { WorkflowStore } from '../../../../store/workflow-store.js';
import { AxCommandService } from '../../service.js';

describe('AxCommandService capability read gateway', () => {
  it('uses the catalog and persisted connections for capability discovery', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    store.setConnection('slack', true);
    const service = new AxCommandService(store);

    const response = await service.execute({
      name: 'capability.list',
      args: { connector: 'slack', kind: 'write' },
    });

    expect(response.status).toBe('ok');
    expect(response.data).toMatchObject({
      capabilities: expect.arrayContaining([
        expect.objectContaining({ connector: 'slack', connection: 'ready' }),
      ]),
    });
  });
});
