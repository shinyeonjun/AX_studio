import type { WorkflowIR } from '../../../../workflow/schema.js';
import type { RepairCandidateOperation } from '../../../../workflow/repair.js';

export const repairCommandCandidate: RepairCandidateOperation = {
  id: 'repair_command_candidate',
  op: 'rename_column',
  sourceId: 'sheet:sales',
  stepId: 'read_sales',
  from: 'customer_count',
  to: 'customers',
  expectedType: 'number',
  actualType: 'integer',
  confidence: 0.65,
};

export function repairCommandWorkflow(): WorkflowIR {
  return {
    id: 'discovery_wd_command_repair',
    version: 1,
    name: 'command repair fixture',
    goal: 'repair command를 검증한다',
    trigger: { type: 'manual' },
    inputs: ['sourcePath'],
    steps: [{
      type: 'action',
      id: 'read_sales',
      connector: 'local_sheet',
      action: 'read',
      params: { path: 'sales.csv' },
      sideEffect: 'NONE',
    }, {
      type: 'action',
      id: 'eval_customer_count',
      connector: 'transform',
      action: 'evaluate',
      params: {
        expr: {
          op: 'aggregate',
          input: { op: 'source', sourceId: 'sheet:sales' },
          fn: 'sum',
          column: 'customer_count',
        },
        outputPath: 'field.customer_count',
      },
      bindings: { table: { from: 'read_sales', output: 'sheet' } },
      sideEffect: 'NONE',
    }],
    permissions: {},
    approval: [],
    allowExternalAuto: false,
    assumptions: [],
    sideEffects: {},
    dataPolicy: {},
    outputContract: {
      version: 1,
      fields: [{
        path: 'field.customer_count',
        kind: 'number',
        required: true,
        baseline: { sampleCount: 1, numericMin: 42, numericMax: 42 },
      }],
      inputSchemas: [{
        sourceId: 'sheet:sales',
        stepId: 'read_sales',
        columns: [{ name: 'customer_count', type: 'number' }],
      }],
    },
  };
}
