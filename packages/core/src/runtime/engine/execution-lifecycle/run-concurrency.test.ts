import { describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../../../persistence/db.js';
import { WorkflowStore } from '../../../persistence/workflow-store.js';
import type { WorkflowIR } from '../../../workflow/schema.js';
import { WorkflowRuntime } from '../../engine.js';
import { createTestConnectors } from '../../../testing/connectors/test-connectors.js';

const workflow: WorkflowIR = {
  id: 'single-run-workflow',
  name: 'Single run', goal: 'One active run per workflow', version: 1, inputs: [],
  steps: [
    { type: 'action', id: 'read', connector: 'gmail', action: 'messages.search',
      params: { query: 'pending' }, sideEffect: 'NONE' },
  ], permissions: {}, approval: [], allowExternalAuto: false, assumptions: [], sideEffects: {}, dataPolicy: {},
};

describe('per-workflow run concurrency', () => {
  it('rejects a manual run while the workflow is active and queues trigger runs', async () => {
    const db = await createDatabaseAsync(':memory:');
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    let active = 0;
    let maxActive = 0;
    const gmail = createTestConnectors().gmail!;
    const runtime = new WorkflowRuntime({
      store: new WorkflowStore(db), globalActive: true,
      connectors: { gmail: { name: 'gmail', execute: async (action, params, ctx) => {
        active += 1; maxActive = Math.max(maxActive, active);
        await held;
        active -= 1;
        return gmail.execute(action, params, ctx);
      } } },
    });
    try {
      const first = runtime.executeWorkflow(workflow, { triggerType: 'gmail.new_message' });
      await new Promise((resolve) => setImmediate(resolve));
      expect(runtime.isWorkflowRunning(workflow.id!)).toBe(true);
      await expect(runtime.executeWorkflow(workflow, { triggerType: 'manual' }))
        .rejects.toMatchObject({ code: 'workflow_already_running' });
      const queued = runtime.executeWorkflow(workflow, { triggerType: 'gmail.new_message' });
      release();
      expect((await first).status).toBe('success');
      expect((await queued).status).toBe('success');
      expect(maxActive).toBe(1);
      expect(runtime.isWorkflowRunning(workflow.id!)).toBe(false);
    } finally { release(); await runtime.waitForIdle(); db.close?.(); }
  });

  it('fails a hung step at its deadline so the runtime can become idle', async () => {
    const db = await createDatabaseAsync(':memory:');
    let observedAbort = false;
    const runtime = new WorkflowRuntime({
      store: new WorkflowStore(db), globalActive: true, stepTimeoutMs: 20,
      connectors: { gmail: { name: 'gmail', execute: (_action, _params, ctx) => new Promise(() => {
        ctx.abortSignal?.addEventListener('abort', () => { observedAbort = true; });
      }) } },
    });
    try {
      const result = await runtime.executeWorkflow(workflow, { triggerType: 'manual' });
      expect(result).toMatchObject({ status: 'failed', errorCode: 'step_timeout' });
      expect(observedAbort).toBe(true);
      await runtime.waitForIdle();
    } finally { db.close?.(); }
  });
});
