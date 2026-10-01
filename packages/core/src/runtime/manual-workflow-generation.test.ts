import { describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../persistence/db.js';
import { WorkflowStore } from '../persistence/workflow-store.js';
import type { WorkflowIR } from '../workflow/schema.js';
import { WorkflowRuntime } from './engine.js';
import { runSavedWorkflowById } from './manual-workflow-run.js';

describe('manual input workflow generation ownership', () => {
  it('does not attach an old input failure to a recreated saved ID', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const id = 'synthetic-manual-preflight';
    const workflow: WorkflowIR = { id, name: 'Synthetic manual input', goal: 'Local input ownership', version: 1,
      trigger: { type: 'gmail.new_message', accountId: 'synthetic' }, inputs: ['messageId'], steps: [
        { type: 'action', id: 'read', connector: 'gmail', action: 'messages.read', params: { messageId: '{{messageId}}' }, sideEffect: 'NONE' },
      ], permissions: {}, approval: [], allowExternalAuto: false, assumptions: [], sideEffects: {}, dataPolicy: {} };
    store.saveWorkflow(workflow);
    let entered!: () => void; let release!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const held = new Promise<void>(resolve => { release = resolve; });
    const runtime = new WorkflowRuntime({ store, globalActive: true, workflowActive: {},
      connectors: { gmail: { name: 'synthetic', execute: async () => {
        entered(); await held; return { ok: true, data: [] };
      } } } });
    const run = runSavedWorkflowById({ store, runtime }, id).then(result => ({ result }), error => ({ error }));
    await started;
    try {
      expect(store.claimWorkflowDeletion(id, 1)).toBe(true);
      await runtime.removeWorkflow(id); expect(store.deleteWorkflow(id)).toBe(true); store.releaseWorkflowDeletion(id);
      store.saveWorkflow({ ...workflow });
      release();
      expect(await run).toMatchObject({ error: { code: 'workflow_removed' } });
      expect(store.listExecutions()).toHaveLength(0);
      expect(store.getWorkflow(id)?.version).toBe(1);
    } finally { release(); await run; db.close?.(); }
  });
});
