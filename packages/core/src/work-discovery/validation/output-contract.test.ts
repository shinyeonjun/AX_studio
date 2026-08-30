import { describe, expect, it } from 'vitest';
import { buildOutputContract } from './output-contract.js';
import type { OutputObservation } from '../observation/schema.js';

describe('Work Discovery output contract builder', () => {
  it('builds bounded baselines from repeated observations without copying example payloads', () => {
    const observations: OutputObservation[] = [
      {
        id: 'obs_1',
        exampleId: 'example_1',
        path: 'field.customer_count',
        label: '고객 수',
        value: { kind: 'number', value: 80 },
        role: 'dynamic_value',
        required: true,
      },
      {
        id: 'obs_2',
        exampleId: 'example_2',
        path: 'field.customer_count',
        label: '고객 수',
        value: { kind: 'number', value: 120 },
        role: 'dynamic_value',
        required: true,
      },
    ];

    const contract = buildOutputContract(observations);

    expect(contract).toEqual({
      version: 1,
      fields: [{
        path: 'field.customer_count',
        kind: 'number',
        required: true,
        baseline: {
          sampleCount: 2,
          numericMin: 80,
          numericMax: 120,
          numericToleranceRatio: 0.2,
        },
      }],
      inputSchemas: [],
    });
    expect(JSON.stringify(contract)).not.toContain('example_1');
    expect(JSON.stringify(contract)).not.toContain('obs_1');
  });
});
