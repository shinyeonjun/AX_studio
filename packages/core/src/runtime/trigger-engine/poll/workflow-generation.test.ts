import { describe, expect, it, vi } from 'vitest';
import { createDatabaseAsync } from '../../../persistence/db.js';
import { WorkflowStore } from '../../../persistence/workflow-store.js';
import { WorkflowRuntime } from '../../engine.js';
import { TriggerEngine } from '../../trigger-engine.js';
import type { ConnectorResult } from '../../../connectors/types.js';
import type { WorkflowIR } from '../../../workflow/schema.js';
import { registerAllModules } from '../../../connectors/packages/register.js';

describe('poll workflow generation ownership', () => {
  it.each(['polled', 'peer'] as const)('does not let a late poll overwrite a recreated %s ID cursor', async (scenario) => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    registerAllModules();
    const id = 'synthetic-late-poll';
    const workflow: WorkflowIR = { id, name: 'Synthetic poll', goal: 'Local lifetime fixture', version: 1,
      trigger: { type: 'gmail.new_message', accountId: 'synthetic' }, inputs: [], steps: [],
      permissions: {}, approval: [], allowExternalAuto: false, assumptions: [], sideEffects: {}, dataPolicy: {} };
    store.saveWorkflow(workflow);
    store.setWorkflowActive(id, true);
    const replacedId = scenario === 'polled' ? id : 'synthetic-peer-cursor';
    if (scenario === 'peer') store.saveWorkflow({ ...workflow, id: replacedId, trigger: { type: 'manual' } });
    store.setSetting('trigger.cursors', { [replacedId]: { initialized: true, historyId: 'previous-generation' } });
    let release!: (value: ConnectorResult) => void;
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const pending = new Promise<ConnectorResult>(resolve => { release = resolve; });
    const runtime = new WorkflowRuntime({ store, globalActive: true, workflowActive: {},
      connectors: { gmail: { name: 'gmail', execute: async () => { entered(); return pending; } } } });
    const engine = new TriggerEngine(store, runtime);
    const tick = engine.tick();
    await started;
    try {
      expect(store.claimWorkflowDeletion(replacedId, 1)).toBe(true);
      await runtime.removeWorkflow(replacedId);
      expect(store.deleteWorkflow(replacedId)).toBe(true);
      store.releaseWorkflowDeletion(replacedId);
      store.saveWorkflow({ ...workflow, id: replacedId });
      store.setWorkflowActive(replacedId, true);
      store.setSetting('trigger.cursors', { [replacedId]: { initialized: true, historyId: 'fresh-generation' } });
      release({ ok: true, data: { events: [], cursor: { initialized: true, historyId: 'old-generation' } } });
      await tick;
      expect(store.getSetting<Record<string, { historyId: string }>>('trigger.cursors', {})[replacedId]?.historyId).toBe('fresh-generation');
    } finally {
      release({ ok: true, data: { events: [], cursor: {} } });
      await tick; await engine.stop(); db.close?.();
    }
  });

  it.each(['success', 'error'] as const)('leaves a recreated receipt alone after a late %s', async (outcome) => {
    registerAllModules();
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const id = 'synthetic-poll-receipt';
    const workflow: WorkflowIR = { id, name: 'Synthetic receipt', goal: 'Local receipt ownership', version: 1,
      trigger: { type: 'gmail.new_message', accountId: 'synthetic' }, inputs: [], steps: [],
      permissions: {}, approval: [], allowExternalAuto: false, assumptions: [], sideEffects: {}, dataPolicy: {} };
    store.saveWorkflow(workflow); store.setWorkflowActive(id, true);
    const runtime = new WorkflowRuntime({ store, globalActive: true, workflowActive: {},
      connectors: { gmail: { name: 'gmail', execute: async () => ({ ok: true, data: {
        events: [{ type: 'gmail.new_message', payload: { messageId: 'synthetic-event' } }],
        cursor: { initialized: true },
      } }) } } });
    let entered!: () => void; let release!: () => void;
    const completed = new Promise<void>(resolve => { entered = resolve; });
    const held = new Promise<void>(resolve => { release = resolve; });
    const execute = runtime.executeWorkflow.bind(runtime);
    vi.spyOn(runtime, 'executeWorkflow').mockImplementation(async (ir, options) => {
      const result = await execute(ir, options); entered(); await held;
      if (outcome === 'error') throw new Error('synthetic late delivery error');
      return result;
    });
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const engine = new TriggerEngine(store, runtime);
    const tick = engine.tick(); await completed;
    const dedupeKey = `${id}:gmail.new_message:synthetic-event`;
    try {
      expect(store.claimWorkflowDeletion(id, 1)).toBe(true);
      await runtime.removeWorkflow(id); expect(store.deleteWorkflow(id)).toBe(true); store.releaseWorkflowDeletion(id);
      store.saveWorkflow({ ...workflow });
      expect(store.claimTriggerReceipt({ dedupeKey, workflowId: id, triggerType: 'gmail.new_message' })).toBe(true);
      release(); await tick;
      expect(db.prepare('SELECT status FROM trigger_receipts WHERE dedupe_key = ?').get(dedupeKey)).toEqual({ status: 'processing' });
    } finally { release(); await tick; await engine.stop(); log.mockRestore(); db.close?.(); }
  });
});
