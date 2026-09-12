import { describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../../persistence/db.js';
import { WorkflowStore } from '../../persistence/workflow-store.js';
import { WorkflowRuntime } from '../engine.js';
import type { WorkflowIR } from '../../workflow/schema.js';

const approvedWorkflow: WorkflowIR = { inputs: [],
  name: 'Approval lifecycle', goal: 'Synthetic delayed connector', version: 1,
  steps: [
    { type: 'human_approval', id: 'approve', reason: 'Review', forActionIds: ['send'] },
    { type: 'action', id: 'send', connector: 'gmail', action: 'message.send',
      params: { to: 'test@example.invalid', body: 'synthetic' }, sideEffect: 'EXTERNAL_HIGH' },
  ], permissions: {}, approval: [], allowExternalAuto: true, assumptions: [], sideEffects: {}, dataPolicy: {},
};

describe('runtime resource lifecycle', () => {
  it('bounds accepted one-shot backlog without losing accepted jobs', async () => {
    const db = await createDatabaseAsync(':memory:');
    const runtime = new WorkflowRuntime({ store: new WorkflowStore(db), globalActive: true, workflowActive: {} });
    try {
      for (let i = 0; i < 128; i++) runtime.enqueueEphemeralWorkflow(approvedWorkflow);
      expect(() => runtime.enqueueEphemeralWorkflow(approvedWorkflow)).toThrow('runtime_queue_full');
    } finally { await runtime.waitForIdle(); db.close?.(); }
  });
  it('waits for an approval-resumed action before becoming idle', async () => {
    const db = await createDatabaseAsync(':memory:');
    let release!: () => void;
    let entered!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    const runtime = new WorkflowRuntime({ store: new WorkflowStore(db), globalActive: true, workflowActive: {},
      connectors: { gmail: { name: 'gmail', execute: async () => {
        entered(); await held; return { ok: true, data: {} };
      } } },
    });
    let resumed: ReturnType<WorkflowRuntime['continueAfterApproval']> | undefined;
    try {
      const first = await runtime.executeWorkflow(approvedWorkflow, { ephemeral: true });
      expect(first.status).toBe('pending_approval');
      resumed = runtime.continueAfterApproval(first.pendingApprovalId!);
      await started;
      let idle = false;
      const wait = runtime.waitForIdle().then(() => { idle = true; });
      await new Promise(resolve => setImmediate(resolve));
      expect(idle).toBe(false);
      release();
      expect((await resumed).status).toBe('success');
      await wait;
      expect(idle).toBe(true);
    } finally { release(); await resumed; db.close?.(); }
  });
});
