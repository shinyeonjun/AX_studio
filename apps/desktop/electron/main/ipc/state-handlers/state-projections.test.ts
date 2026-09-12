import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDatabaseAsync, WorkflowStore, parseWorkflowIR, type AppDatabase } from '@ax-studio/core';
import { buildExecutions } from './execution-state.js';
import { buildWorkflowSummaries } from './workflow-state.js';

describe('bounded application state projections', () => {
  let db: AppDatabase;
  let store: WorkflowStore;
  beforeEach(async () => { db = await createDatabaseAsync(':memory:'); store = new WorkflowStore(db); });
  afterEach(() => { vi.restoreAllMocks(); db.close?.(); });
  const workflow = () => parseWorkflowIR({ name: 'Test', goal: 'Calculate', version: 1,
    trigger: { type: 'manual' }, steps: [{ type: 'action', id: 'notify', connector: 'slack',
      action: 'message.send', params: { channel: '#test', text: 'fixed text' }, sideEffect: 'EXTERNAL' }] });

  it('keeps older workflow status while caching only immutable version details', () => {
    const ir = workflow();
    const { workflowId } = store.saveWorkflow(ir);
    const id = store.createExecution({ workflowId, ephemeral: false });
    store.finishExecution(id, 'success');
    db.prepare('UPDATE executions SET started_at = ? WHERE id = ?').run('2020-01-01T00:00:00.000Z', id);
    for (let i = 0; i < 60; i++) store.finishExecution(store.createExecution({ ephemeral: true }), 'success');
    const read = vi.spyOn(store, 'getWorkflow');
    expect(buildWorkflowSummaries({ store })[0]).toMatchObject({ lastStatus: 'success', goal: 'Calculate' });
    store.setWorkflowActive(workflowId, true);
    expect(buildWorkflowSummaries({ store })[0]?.active).toBe(true);
    expect(read).toHaveBeenCalledTimes(1);
    store.saveWorkflow({ ...ir, id: workflowId, goal: 'Updated' });
    expect(buildWorkflowSummaries({ store })[0]?.goal).toBe('Updated');
    expect(read).toHaveBeenCalledTimes(2);
    store.deleteWorkflow(workflowId);
    expect(buildWorkflowSummaries({ store })).toEqual([]);
  });

  it('does not broadcast large output bodies and invalidates progress and terminal state', () => {
    const output = { version: 1 as const,
      fields: Array.from({ length: 4 }, (_, i) => ({ path: `value${i}`, valueJson: JSON.stringify('x'.repeat(60_000)) })) };
    for (let i = 0; i < 50; i++) {
      const id = store.createExecution({ ephemeral: true });
      store.finishExecution(id, 'success', undefined, [], output);
    }
    const state = buildExecutions({ store });
    expect(state).toHaveLength(50);
    expect(state.every(execution => execution.hasOutput && !('output' in execution))).toBe(true);
    expect(JSON.stringify(state).length).toBeLessThan(50_000);
    expect(store.getExecution(state[0]!.id)?.output).toEqual(output);
    const id = state[0]!.id;
    store.updateExecutionLog(id, [{ code: 'step_failed', message: 'failed step', level: 'error', data: { stepId: 'x' } }]);
    expect(buildExecutions({ store }).find(row => row.id === id)?.errorMessage).toBe('failed step');
    store.finishExecution(id, 'failed', 'output_contract_failed');
    expect(buildExecutions({ store }).find(row => row.id === id)).toMatchObject({ hasOutput: false, resultStatus: 'failed' });
    store.deleteExecution(id);
    expect(buildExecutions({ store }).some(row => row.id === id)).toBe(false);
  });
});
