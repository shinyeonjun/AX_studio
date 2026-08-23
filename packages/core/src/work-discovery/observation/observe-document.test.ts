import { describe, expect, it } from 'vitest';
import { observeDocumentArtifact, parseKoreanNumber } from './observe-document.js';

describe('observeDocumentArtifact', () => {
  it('extracts label-value numbers with page provenance', () => {
    const observations = observeDocumentArtifact('ex_1', {
      id: 'doc_1',
      text: '월간 영업 보고서\n총매출: 12.4억\n고객수: 120',
      pages: [{ index: 0, text: '총매출: 12.4억' }],
      tables: [],
      images: [],
    });

    const revenue = observations.find((entry) => entry.label === '총매출');
    expect(revenue).toMatchObject({
      path: expect.any(String),
      value: { kind: 'number', value: 1_240_000_000, display: '12.4억' },
      location: { pageIndex: 0 },
      role: 'dynamic_value',
    });
    expect(observations.some((entry) => entry.label === '고객수')).toBe(true);
  });
});

describe('parseKoreanNumber', () => {
  it('parses 억 and plain numbers', () => {
    expect(parseKoreanNumber('12.4억')).toBe(1_240_000_000);
    expect(parseKoreanNumber('1,240')).toBe(1240);
  });
});
