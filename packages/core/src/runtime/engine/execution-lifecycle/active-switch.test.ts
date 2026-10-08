import { describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../../../persistence/db.js';
import { WorkflowStore } from '../../../persistence/workflow-store.js';
import type { WorkflowIR } from '../../../workflow/schema.js';
import { WorkflowRuntime } from '../../engine.js';
import { createTestConnectors } from '../../../testing/connectors/test-connectors.js';

const workflow: WorkflowIR = {
  id: 'switched-workflow',
  name: '메일 확인', goal: '새 메일을 읽는다', version: 1, inputs: [],
  trigger: { type: 'gmail.new_message', accountId: 'primary' },
  steps: [{ type: 'action', id: 'read', connector: 'gmail', action: 'messages.search', params: { query: 'pending' }, sideEffect: 'NONE' }],
  permissions: {}, approval: [], allowExternalAuto: false, assumptions: [], sideEffects: {}, dataPolicy: {},
};

/**
 * Whether a saved job may run automatically is the switch saved with it. Settings, a confirmed
 * chat card, an edit that needs re-approval and the scheduler all flip that one switch; the
 * runtime must never keep its own copy that one of them forgets to update.
 */
describe('the saved on/off switch decides automatic runs', () => {
  async function setup(activeAtStart: boolean) {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    store.saveWorkflow(workflow);
    store.setWorkflowActive(workflow.id!, activeAtStart);
    const runtime = new WorkflowRuntime({ store, globalActive: true, connectors: createTestConnectors() });
    return { db, store, runtime };
  }

  it('runs a job switched on after the app started, by any path', async () => {
    const { db, store, runtime } = await setup(false);
    try {
      store.setWorkflowActive(workflow.id!, true);
      const result = await runtime.executeWorkflow(workflow, { triggerType: 'gmail.new_message' });
      expect(result.status).toBe('success');
    } finally { await runtime.waitForIdle(); db.close?.(); }
  });

  it('holds a job switched off after the app started, by any path, while manual runs still work', async () => {
    const { db, store, runtime } = await setup(true);
    try {
      store.setWorkflowActive(workflow.id!, false);
      const automatic = await runtime.executeWorkflow(workflow, { triggerType: 'gmail.new_message' });
      expect(automatic).toMatchObject({ status: 'cancelled', errorCode: 'workflow_paused' });
      const manual = await runtime.executeWorkflow(workflow, { triggerType: 'manual' });
      expect(manual.status).toBe('success');
    } finally { await runtime.waitForIdle(); db.close?.(); }
  });

  it('runs a job that was never saved (a one-off run) automatically', async () => {
    const db = await createDatabaseAsync(':memory:');
    const runtime = new WorkflowRuntime({ store: new WorkflowStore(db), globalActive: true, connectors: createTestConnectors() });
    try {
      expect((await runtime.executeWorkflow({ ...workflow, id: 'one-off' }, { triggerType: 'gmail.new_message' })).status).toBe('success');
    } finally { await runtime.waitForIdle(); db.close?.(); }
  });
});
