import { describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../store/db.js';
import { WorkflowStore } from '../store/workflow-store.js';
import type { ExecutionResult } from './types.js';
import { WorkflowRuntime } from './engine.js';
import { runManualWorkflow } from './manual-workflow-run.js';
import type { WorkflowIR } from '../workflow/schema.js';

const missingInputWorkflow: WorkflowIR = {
  id: 'wf-manual-input',
  name: 'PDF 입력 필요',
  goal: '연결된 PDF를 처리한다',
  version: 1,
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
