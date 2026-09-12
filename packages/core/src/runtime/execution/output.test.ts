import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDatabaseAsync, type AppDatabase } from '../../persistence/db.js';
import { WorkflowStore } from '../../persistence/workflow-store.js';
import { WorkflowRuntime } from '../engine.js';
import { TransformConnector } from '../../connectors/transform/connector.js';
import { buildTableArtifact } from '../../contracts/artifacts/table-build.js';
import type { WorkflowIR } from '../../workflow/schema.js';

const workflow = (): WorkflowIR => ({
  id: 'calculated-result', name: 'Calculated result', goal: 'Persist exact calculated output', version: 1, inputs: [],
  permissions: {}, approval: [], allowExternalAuto: false, assumptions: [], sideEffects: {}, dataPolicy: {},
  steps: [
    { type: 'action', id: 'read', connector: 'local_sheet', action: 'read', sideEffect: 'NONE', params: { path: 'fixture.csv' } },
    { type: 'action', id: 'calculate', connector: 'transform', action: 'evaluate', sideEffect: 'NONE',
      bindings: { table: { from: 'read', output: 'sheet' } },
      params: { expr: { op: 'aggregate', input: { op: 'source', sourceId: 'source' }, fn: 'sum', column: 'amount' },
        discoverySourceId: 'source', outputPath: 'total', outputLabel: 'Total' } },
  ],
});

describe('calculated execution output', () => {
  let db: AppDatabase;
  let store: WorkflowStore;
  let runtime: WorkflowRuntime;
  let sourceValue: string | number;
  beforeEach(async () => {
    db = await createDatabaseAsync(':memory:');
    store = new WorkflowStore(db);
    sourceValue = 0;
    runtime = new WorkflowRuntime({ store, globalActive: true, workflowActive: {},
      connectors: { transform: new TransformConnector(), local_sheet: { name: 'local_sheet',
        execute: async () => ({ ok: true, data: buildTableArtifact({ id: 'source', headers: ['amount'], matrix: [[sourceValue]] }) }) } } });
  });
  afterEach(() => db.close?.());

  it('preserves zero and excludes unrelated private inputs', async () => {
    const result = await runtime.executeWorkflow(workflow(), { input: { token: 'private-input' } });
    expect(result.status).toBe('success');
    expect(result.output).toEqual({ version: 1, fields: [{ path: 'total', label: 'Total', valueJson: '0' }] });
    expect(store.getExecution(result.executionId)?.output).toEqual(result.output);
    expect(JSON.stringify(result.output)).not.toContain('private-input');
  });

  it('does not publish inputs named after an unexecuted branch step', async () => {
    const ir = workflow();
    ir.steps.splice(1, 0, { type: 'if', id: 'branch', condition: { op: 'eq', left: { lit: 1 }, right: { lit: 2 } },
      thenStepIds: ['calculate'] });
    const result = await runtime.executeWorkflow(ir, { input: { calculate: { value: 999 } } });
    expect(result.status).toBe('success');
    expect(result.output).toBeUndefined();
    expect(store.getExecution(result.executionId)?.output).toBeUndefined();
  });

  it('keeps calculated results through a persisted approval checkpoint', async () => {
    const ir = workflow();
    let sent = 0;
    runtime.setConnector('slack', { name: 'slack', execute: async () => { sent++; return { ok: true, data: { ts: 'sent' } }; } });
    ir.steps.push({ type: 'action', id: 'send', connector: 'slack', action: 'message.send',
      params: { channel: 'test-channel', text: 'calculated' }, sideEffect: 'EXTERNAL' });
    const pending = await runtime.executeWorkflow(ir);
    expect(pending.status).toBe('pending_approval');
    expect(pending.output).toBeUndefined();
    expect(store.getExecution(pending.executionId)?.output).toBeUndefined();
    expect(sent).toBe(0);
    const resumed = await runtime.continueAfterApproval(pending.pendingApprovalId!);
    expect(resumed.status).toBe('success');
    expect(resumed.output?.fields[0]?.valueJson).toBe('0');
    expect(store.getExecution(pending.executionId)?.output).toEqual(resumed.output);
    expect(sent).toBe(1);
  });

  it.each([false, true])('fails oversized output without partial results or external delivery (send=%s)', async (send) => {
    const ir = workflow();
    sourceValue = 'x'.repeat(65_537);
    if (ir.steps[1]?.type === 'action') ir.steps[1].params.expr = { op: 'source', sourceId: 'source' };
    let sent = 0;
    if (send) {
      ir.allowExternalAuto = true;
      runtime.setConnector('slack', { name: 'slack', execute: async () => { sent++; return { ok: true }; } });
      ir.steps.push({ type: 'action', id: 'send', connector: 'slack', action: 'message.send',
        params: { channel: 'test-channel', text: 'calculated' }, sideEffect: 'EXTERNAL' });
    }
    const result = await runtime.executeWorkflow(ir);
    expect(result.status).toBe('failed');
    expect(result.errorCode).toBe('execution_output_invalid');
    expect(store.getExecution(result.executionId)?.output).toBeUndefined();
    expect(sent).toBe(0);
  });
});
