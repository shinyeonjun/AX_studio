import { describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../persistence/db.js';
import { WorkflowStore } from '../persistence/workflow-store.js';
import type { ExecutionResult } from './types.js';
import { WorkflowRuntime } from './engine.js';
import { runManualWorkflow, runSavedWorkflowById } from './manual-workflow-run.js';
import type { WorkflowIR } from '../workflow/schema.js';

const missingInputWorkflow: WorkflowIR = {
  id: 'wf-manual-input',
  name: 'PDF 입력 필요',
  goal: '연결된 PDF를 처리한다',
  version: 1,
  inputs: [],
  steps: [{
    type: 'action',
    id: 'ingest',
    connector: 'document',
    action: 'ingest',
    params: { path: '{{filePath}}' },
    sideEffect: 'NONE',
  }],
  permissions: {},
  approval: [],
  allowExternalAuto: true,
  assumptions: [],
  sideEffects: {},
  dataPolicy: {},
};

describe('saved manual workflow completion observer', () => {
  it('rejects duplicate runs during async input preparation and releases the guard after completion', async () => {
    const db = await createDatabaseAsync(':memory:');
    try {
      const store = new WorkflowStore(db);
      const workflow: WorkflowIR = { ...missingInputWorkflow, id: 'saved-empty', steps: [] };
      store.saveWorkflow(workflow);
      const runtime = new WorkflowRuntime({ store, globalActive: true, workflowActive: {} });
      const deps = { store, runtime };
      const first = runSavedWorkflowById(deps, workflow.id!);
      expect(store.listExecutions()).toHaveLength(0);
      await expect(runSavedWorkflowById(deps, workflow.id!)).rejects.toMatchObject({ code: 'workflow_already_running' });
      expect((await first).status).toBe('success');
      expect((await runSavedWorkflowById(deps, workflow.id!)).status).toBe('success');
      expect(store.listExecutions()).toHaveLength(2);
      const pending = store.createExecution({ workflowId: workflow.id, ephemeral: false });
      store.markExecutionPending(pending);
      await expect(runSavedWorkflowById(deps, workflow.id!)).rejects.toMatchObject({ code: 'workflow_already_running' });
      expect(store.listExecutions()).toHaveLength(3);
    } finally { db.close?.(); }
  });

  it('notifies the shared completion boundary when input preflight fails', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const finished: ExecutionResult[] = [];
    const runtime = new WorkflowRuntime({
      store,
      globalActive: true,
      workflowActive: {},
      onExecutionFinished: (result) => finished.push(result),
    });

    const result = await runManualWorkflow(
      { store, runtime },
      missingInputWorkflow,
      { ephemeral: false, workflowId: missingInputWorkflow.id },
    );

    expect(result.status).toBe('failed');
    expect(store.getExecution(result.executionId)).toMatchObject({
      status: 'failed',
      workflowId: missingInputWorkflow.id,
    });
    expect(finished).toEqual([result]);
  });
});
