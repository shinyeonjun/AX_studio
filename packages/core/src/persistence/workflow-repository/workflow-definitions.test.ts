import { describe, expect, it, vi } from 'vitest';
import { createDatabaseAsync } from '../db.js';
import { WorkflowStore } from '../workflow-store.js';

describe('workflow definitions batch read', () => {
  it('returns active and inactive workflows with only their latest saved version', async () => {
    const db = await createDatabaseAsync(':memory:');
    try {
      const store = new WorkflowStore(db);
      const workflow = {
        id: 'workflow-batch', name: 'Batch read', goal: 'Avoid per-workflow reads', version: 1,
        steps: [], permissions: {}, approval: [], allowExternalAuto: true,
        assumptions: [], sideEffects: {}, dataPolicy: {},
      };
      store.saveWorkflow(workflow);
      store.saveWorkflow({ ...workflow, goal: 'Latest saved version' });
      const active = store.saveWorkflow({ ...workflow, id: 'workflow-active', name: 'Active' });
      store.setWorkflowActive(active.workflowId, true);
      const timestamp = new Date().toISOString();
      db.prepare('INSERT INTO workflows (id, name, active, created_at, updated_at) VALUES (?, ?, 0, ?, ?)')
        .run('workflow-without-version', 'Incomplete migration row', timestamp, timestamp);
      const originalPrepare = db.prepare.bind(db);
      const prepare = vi.spyOn(db, 'prepare').mockImplementation((sql) => originalPrepare(sql));

      const definitions = store.listWorkflowDefinitions();
      expect(definitions).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'workflow-batch', active: false, latestVersion: 2,
          workflow: expect.objectContaining({ goal: 'Latest saved version', version: 2 }) }),
        expect.objectContaining({ id: 'workflow-active', active: true, latestVersion: 1,
          workflow: expect.objectContaining({ goal: 'Avoid per-workflow reads', version: 1 }) }),
        expect.objectContaining({ id: 'workflow-without-version', active: false, latestVersion: 0, workflow: null }),
      ]));
      expect(prepare.mock.calls.filter(([sql]) => sql.includes('FROM workflows w'))).toHaveLength(1);
    } finally {
      db.close?.();
    }
  });
});
