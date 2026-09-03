import { describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../../../store/db.js';
import { WorkflowStore } from '../../../store/workflow-store.js';
import { WorkflowRuntime } from '../../engine.js';
import { createTestConnectors } from '../../../modules/test-connectors.js';
import { buildTableArtifact } from '../../../contracts/artifacts/table-build.js';

describe('runtime engine repair proposal guards', () => {
  it('persists a bounded repair proposal on input schema drift without applying it', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const table = buildTableArtifact({
      id: 'customers_renamed',
      headers: ['customers'],
      matrix: [[42]],
    });
    const connectors = createTestConnectors();
    connectors.local_sheet = {
      name: 'local_sheet',
      execute: async (_action, _params, ctx) => {
        ctx.variables.sheet = table;
        return { ok: true, data: table };
      },
    };
    const workflow = {
      id: 'workflow-runtime-repair',
      version: 1,
      name: 'runtime repair proposal',
      goal: 'schema drift를 제안으로만 남긴다',
      trigger: { type: 'manual' as const },
      inputs: ['sourcePath'],
      steps: [{
        type: 'action' as const,
        id: 'read_customers',
        connector: 'local_sheet',
        action: 'read',
        params: { path: 'customers.csv' },
        sideEffect: 'NONE' as const,
      }],
      permissions: {},
      approval: [],
      allowExternalAuto: false,
      assumptions: [],
      sideEffects: {},
      dataPolicy: {},
      outputContract: {
        version: 1 as const,
        fields: [],
        inputSchemas: [{
          sourceId: 'input:customers',
          stepId: 'read_customers',
          columns: [{ name: 'customer_count', type: 'number' as const }],
        }],
      },
    };
    store.saveWorkflow(workflow);
    const runtime = new WorkflowRuntime({
      store,
      globalActive: true,
      workflowActive: { [workflow.id]: true },
      connectors,
    });

    const result = await runtime.executeWorkflow(workflow);

    expect(result).toMatchObject({ status: 'failed', errorCode: 'input_schema_drift' });
    expect(store.listRepairProposals({ workflowId: workflow.id })).toMatchObject([{
      baseVersion: 1,
      status: 'proposed',
      candidates: [{
        op: 'rename_column',
        from: 'customer_count',
        to: 'customers',
      }],
      replay: { status: 'not_run' },
    }]);
    db.close?.();
  });
});
