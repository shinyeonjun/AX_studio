import { describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../../../store/db.js';
import { WorkflowStore } from '../../../store/workflow-store.js';
import { WorkflowRuntime } from '../../engine.js';
import { createTestConnectors, mockSlack } from '../../../modules/test-connectors.js';
import { buildTableArtifact } from '../../../contracts/artifacts/table-build.js';
import { OutputContractSchema } from '../../../contracts/output-contract.js';

describe('runtime engine output contract guards', () => {
  it('blocks external delivery when the discovered output falls outside its baseline', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const table = buildTableArtifact({
      id: 'customers_current',
      headers: ['customer_count'],
      matrix: [[1], [2], [3]],
    });
    const connectors = createTestConnectors();
    connectors.local_sheet = {
      name: 'local_sheet',
      execute: async (_action, _params, ctx) => {
        ctx.variables.sheet = table;
        return { ok: true, data: table };
      },
    };
    const runtime = new WorkflowRuntime({
      store,
      globalActive: true,
      workflowActive: {},
      connectors,
    });
    const outputContract = OutputContractSchema.parse({
      version: 1,
      fields: [{
        path: 'field.customer_count',
        kind: 'number',
        required: true,
        baseline: { sampleCount: 2, numericMin: 80, numericMax: 120, numericToleranceRatio: 0.2 },
      }],
      inputSchemas: [{
        sourceId: 'input:customers',
        stepId: 'read_customers',
        columns: [{ name: 'customer_count', type: 'number' }],
      }],
    });

    const result = await runtime.executeWorkflow({
      name: '고객 수 결과 게이트',
      goal: '비정상 고객 수를 외부에 보내지 않는다',
      version: 1,
      trigger: { type: 'manual' },
      inputs: ['sourcePath'],
      steps: [
        {
          type: 'action',
          id: 'read_customers',
          connector: 'local_sheet',
          action: 'read',
          params: { path: 'customers.csv' },
          sideEffect: 'NONE',
        },
        {
          type: 'action',
          id: 'evaluate_customer_count',
          connector: 'transform',
          action: 'evaluate',
          params: {
            expr: { op: 'aggregate', input: { op: 'source', sourceId: 'input:customers' }, fn: 'count' },
            discoverySourceId: 'input:customers',
            outputPath: 'field.customer_count',
          },
          bindings: { table: { from: 'read_customers', output: 'sheet' } },
          sideEffect: 'NONE',
        },
        {
          type: 'action',
          id: 'send_customer_count',
          connector: 'slack',
          action: 'message.send',
          params: { channel: '#ops', text: 'customer count' },
          sideEffect: 'EXTERNAL',
        },
      ],
      permissions: {},
      approval: [],
      allowExternalAuto: true,
      assumptions: [],
      sideEffects: {},
      dataPolicy: {},
      outputContract,
    }, { ephemeral: true });

    expect(result).toMatchObject({ status: 'failed', errorCode: 'output_contract_failed' });
    expect(mockSlack(runtime.connectors).messages).toHaveLength(0);
    expect(JSON.stringify(result.log)).toContain('output_volume_anomaly');
  });
});
