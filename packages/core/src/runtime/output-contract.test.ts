import { describe, expect, it } from 'vitest';
import { OutputContractSchema } from '../contracts/output-contract.js';
import { validateInputSchema, validateOutputContract } from './output-contract.js';

describe('output contracts', () => {
  it('reports an output volume anomaly without returning the raw degraded value', () => {
    const contract = OutputContractSchema.parse({
      version: 1,
      fields: [{
        path: 'field.customer_count',
        kind: 'number',
        required: true,
        baseline: { sampleCount: 2, numericMin: 80, numericMax: 120, numericToleranceRatio: 0.2 },
      }],
      inputSchemas: [],
    });

    const result = validateOutputContract(contract, {
      discoveryFields: { 'field.customer_count': 3 },
    }, {});

    expect(result.ok).toBe(false);
    expect(result.issues).toEqual([
      expect.objectContaining({ code: 'output_volume_anomaly', path: 'field.customer_count' }),
    ]);
    expect(JSON.stringify(result)).not.toContain('"actual":3');
  });

  it('reports a missing input column as schema drift', () => {
    const contract = OutputContractSchema.parse({
      version: 1,
      fields: [],
      inputSchemas: [{
        sourceId: 'input:customers',
        stepId: 'read_customers',
        columns: [{ name: 'customer_count', type: 'number' }],
      }],
    });

    const result = validateInputSchema(contract, 'read_customers', {
      kind: 'table',
      id: 'current_customers',
      columns: [{ name: 'customers', type: 'integer', nullable: true, inferred: true }],
      rows: [],
      truncated: false,
    });

    expect(result.ok).toBe(false);
    expect(result.issues).toEqual([
      expect.objectContaining({ code: 'schema_column_missing', path: 'customer_count' }),
    ]);
  });

  it('reports output type changes and input column type changes', () => {
    const contract = OutputContractSchema.parse({
      version: 1,
      fields: [{
        path: 'field.customer_count',
        kind: 'number',
        required: true,
        baseline: { sampleCount: 2, numericMin: 80, numericMax: 120 },
      }],
      inputSchemas: [{
        sourceId: 'input:customers',
        stepId: 'read_customers',
        columns: [{ name: 'customer_count', type: 'number' }],
      }],
    });

    const output = validateOutputContract(contract, {
      discoveryFields: { 'field.customer_count': 'three' },
    }, {});
    const input = validateInputSchema(contract, 'read_customers', [{ customer_count: 'three' }]);

    expect(output.issues).toEqual([
      expect.objectContaining({ code: 'output_type_changed', path: 'field.customer_count' }),
    ]);
    expect(input.issues).toEqual([
      expect.objectContaining({ code: 'schema_type_changed', path: 'customer_count' }),
    ]);
  });

  it('does not reject a one-sample baseline solely because its numeric value changed', () => {
    const contract = OutputContractSchema.parse({
      version: 1,
      fields: [{
        path: 'field.total',
        kind: 'number',
        required: true,
        baseline: { sampleCount: 1, numericMin: 300, numericMax: 300 },
      }],
      inputSchemas: [],
    });

    const result = validateOutputContract(contract, {
      discoveryFields: { 'field.total': 600 },
    }, {});

    expect(result).toEqual({ ok: true, issues: [] });
  });
});
