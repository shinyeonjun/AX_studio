import type { OutputContract } from '../../contracts/output-contract.js';
import type { TableArtifact } from '../../contracts/artifacts/table.js';
import type { WorkflowIR } from '../schema.js';

export const sourceId = 'sheet:sales';
export const stepId = 'read_sales';

export const contract: OutputContract = {
  version: 1,
  fields: [],
  inputSchemas: [{
    sourceId,
    stepId,
    columns: [
      { name: 'customer_count', type: 'number' },
      { name: 'status', type: 'string' },
    ],
  }],
};

export const actualTable: TableArtifact = {
  id: 'sales-current',
  kind: 'table',
  columns: [
    { name: 'customers', type: 'integer', nullable: false, inferred: true },
    { name: 'status', type: 'string', nullable: true, inferred: true },
  ],
  rows: [{ index: 0, values: { customers: 42, status: 'active' } }],
  truncated: false,
};

export function workflowFixture(): WorkflowIR {
  return {
    id: 'workflow-repair',
    version: 1,
    name: '고객 집계',
    goal: '고객 수를 집계한다',
    trigger: { type: 'schedule', schedule: '0 9 * * *', timezone: 'Asia/Seoul' },
    inputs: ['sourcePath'],
    steps: [
      {
        type: 'action',
        id: stepId,
        connector: 'local_sheet',
        action: 'read',
        params: { path: '{{sourcePath}}' },
        sideEffect: 'NONE',
      },
      {
        type: 'action',
        id: 'eval_customer_count',
        connector: 'transform',
        action: 'evaluate',
        params: {
          expr: {
            op: 'aggregate',
            input: { op: 'source', sourceId },
            fn: 'sum',
            column: 'customer_count',
          },
          discoverySourceId: sourceId,
          outputPath: 'field.customer_count',
        },
        sideEffect: 'NONE',
      },
    ],
    permissions: { 'local_sheet.read': true, 'transform.evaluate': true },
    approval: ['approval-required'],
    allowExternalAuto: false,
    assumptions: ['보존해야 하는 가정'],
    sideEffects: { notify: 'EXTERNAL' },
    dataPolicy: { gmail: { cloudAllowed: false } },
    outputContract: contract,
    document: JSON.stringify({
      origin: 'discovery',
      fields: [{
        outputPath: 'field.customer_count',
        mapping: {
          op: 'aggregate',
          input: { op: 'source', sourceId },
          fn: 'sum',
          column: 'customer_count',
        },
      }],
    }),
  };
}
