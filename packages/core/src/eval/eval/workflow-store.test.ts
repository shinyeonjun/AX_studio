import { describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../../store/db.js';
import { WorkflowStore } from '../../store/workflow-store.js';
import { csMailWorkflowFixture } from '../../testing/fixtures/workflows.js';

describe('WorkflowStore', () => {
  it('CRUD roundtrip', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const { workflowId } = store.saveWorkflow(csMailWorkflowFixture);
    const loaded = store.getWorkflow(workflowId);
    expect(loaded?.name).toBe('고객 문의 처리');
    store.setConnection('gmail', true);
    expect(store.getConnections()[0].connected).toBe(true);
  });
});
