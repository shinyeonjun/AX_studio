import { describe, expect, it } from 'vitest';
import { resultNameFromFile } from './start-actions';

describe('the name a learned work gets from its example file', () => {
  it.each([
    ['월간매출요약_2026-08.xlsx', '월간매출요약'],
    ['2026년 8월 영업보고.pdf', '영업보고'],
    ['sales_report_v2 (1).xlsx', 'sales report'],
    ['매출_q3_v2.csv', '매출'],
    ['2026-08.xlsx', undefined],
  ])('%s -> %s', (fileName, expected) => {
    expect(resultNameFromFile(fileName)).toBe(expected);
  });
});
