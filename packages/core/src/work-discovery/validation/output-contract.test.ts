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
          numericToleranceRatio: 1,
        },
      }],
      inputSchemas: [],
    });
    expect(JSON.stringify(contract)).not.toContain('example_1');
    expect(JSON.stringify(contract)).not.toContain('obs_1');
  });
});

describe('the anomaly guard of a learned monthly report', () => {
  it('lets normal growth through and holds a value that is clearly wrong', async () => {
    const { rangeContains } = await import('../../runtime/output-contract/output/range.js');
    // Examples: August 10.0M, September 11.0M; tolerance as built for new contracts.
    const ratio = 1;
    expect(rangeContains(13_750_000, 10_000_000, 11_000_000, ratio)).toBe(true); // +25% month
    expect(rangeContains(9_000_000, 10_000_000, 11_000_000, ratio)).toBe(true); // a weaker month
    expect(rangeContains(11_000_000_000, 10_000_000, 11_000_000, ratio)).toBe(false); // won -> 1000x unit slip
    expect(rangeContains(-5_000_000, 10_000_000, 11_000_000, ratio)).toBe(false); // sign flip
  });
});
