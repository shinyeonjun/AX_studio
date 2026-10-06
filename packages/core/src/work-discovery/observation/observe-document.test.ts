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
    expect(revenue).toMatchObject({ path: 'field.총매출', required: true });
  });

  it('requires only uniquely labeled fields and keeps loose or repeated numbers optional', () => {
    const observations = observeDocumentArtifact('ex_1', {
      id: 'doc_loose',
      pages: [{ index: 0, text: '총매출: 100\n지점 매출: 10\n본점 매출: 20\n작년 대비 15% 증가\n담당 3명' }],
      tables: [],
      images: [],
    });
    const required = observations.filter((entry) => entry.required);
    expect(required.map((entry) => entry.path)).toEqual(['field.총매출']);
    expect(observations.filter((entry) => entry.label === '매출').every((entry) => !entry.required)).toBe(true);
    expect(observations.some((entry) => entry.label === '담당' && !entry.required)).toBe(true);
  });

  it('gives the same labeled field the same path in different examples', () => {
    const first = observeDocumentArtifact('ex_1', { id: 'a', text: '머리말\n총매출: 100', pages: [], tables: [], images: [] });
    const second = observeDocumentArtifact('ex_2', { id: 'b', pages: [{ index: 3, text: '총매출: 200' }], tables: [], images: [] });
    expect(first.find((entry) => entry.required)?.path).toBe(second.find((entry) => entry.required)?.path);
  });

  it('keeps repeated labels as distinct stable semantic locations', () => {
    const document = {
      id: 'doc_repeated_rows',
      pages: [
        { index: 0, text: '서울 매출: 100\n부산 매출: 200' },
        { index: 1, text: '서울 매출: 300' },
      ],
      tables: [],
      images: [],
    };

    const first = observeDocumentArtifact('ex_1', document);
    const second = observeDocumentArtifact('ex_1', document);
    const revenuePaths = first
      .filter((entry) => entry.label === '매출')
      .map((entry) => entry.path);

    expect(new Set(revenuePaths).size).toBe(revenuePaths.length);
    expect(first.filter((entry) => entry.label === '매출').every((entry) => !entry.required)).toBe(true);
    expect(revenuePaths).toEqual(
      second.filter((entry) => entry.label === '매출').map((entry) => entry.path),
    );
    expect(revenuePaths).toEqual([
      'field.매출.page_1.segment_1.value_1',
      'field.매출.page_1.segment_1.value_2',
      'field.매출.page_2.segment_2.value_1',
    ]);
  });
});

describe('parseKoreanNumber', () => {
  it('parses 억 and plain numbers', () => {
    expect(parseKoreanNumber('12.4억')).toBe(1_240_000_000);
    expect(parseKoreanNumber('1,240')).toBe(1240);
  });
});
