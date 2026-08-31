import { describe, expect, it } from 'vitest';
import type { OutputContract } from '../contracts/output-contract.js';
import type { TableArtifact } from '../contracts/artifacts/table.js';
import type { WorkflowIR } from './schema.js';
import {
  applyRepairCandidate,
  repairProtectedFingerprint,
  suggestRepairCandidates,
} from './repair.js';

const sourceId = 'sheet:sales';
const stepId = 'read_sales';

const contract: OutputContract = {
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

const actualTable: TableArtifact = {
  id: 'sales-current',
  kind: 'table',
  columns: [
    { name: 'customers', type: 'integer', nullable: false, inferred: true },
    { name: 'status', type: 'string', nullable: true, inferred: true },
  ],
  rows: [{ index: 0, values: { customers: 42, status: 'active' } }],
};

function workflowFixture(): WorkflowIR {
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

describe('conservative workflow repair', () => {
  it('suggests a bounded column candidate without copying row values', () => {
    const candidates = suggestRepairCandidates(contract, stepId, actualTable);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      op: 'rename_column',
      sourceId,
      stepId,
      from: 'customer_count',
      to: 'customers',
      expectedType: 'number',
      actualType: 'integer',
    });
    expect(JSON.stringify(candidates)).not.toContain('"customers":42');
  });

  it('changes only the selected mapping and preserves policy and side-effect meaning', () => {
    const workflow = workflowFixture();
    const candidate = suggestRepairCandidates(contract, stepId, actualTable)[0]!;
    const repaired = applyRepairCandidate(workflow, candidate);

    expect(repaired.version).toBe(workflow.version);
    expect(repaired.approval).toEqual(workflow.approval);
    expect(repaired.trigger).toEqual(workflow.trigger);
    expect(repaired.sideEffects).toEqual(workflow.sideEffects);
    expect(repaired.dataPolicy).toEqual(workflow.dataPolicy);
    expect(repaired.steps[1]).toMatchObject({
      type: 'action',
      params: {
        expr: {
          op: 'aggregate',
          column: 'customers',
        },
      },
    });
    expect(repaired.outputContract?.inputSchemas[0]?.columns).toEqual([
      { name: 'customers', type: 'number' },
      { name: 'status', type: 'string' },
    ]);
    const document = JSON.parse(repaired.document ?? '{}') as { fields?: Array<{ mapping?: { column?: string } }> };
    expect(document.fields?.[0]?.mapping?.column).toBe('customers');
    expect(repairProtectedFingerprint(workflow, candidate)).toBe(
      repairProtectedFingerprint(repaired, candidate),
    );
  });

  it('does not invent a rename for an incompatible type change', () => {
    const changedType: TableArtifact = {
      ...actualTable,
      columns: actualTable.columns.map((column) =>
        column.name === 'customers' ? { ...column, type: 'date' as const } : column,
      ),
    };

    expect(suggestRepairCandidates(contract, stepId, changedType)).toEqual([]);
  });
});
