import { describe, expect, it } from 'vitest';
import { periodFilePath } from './period-file.js';

const period = (start: string) => ({ start, endInclusive: start, label: start });
const august = period('2026-08-01');
const september = period('2026-09-01');

describe('the file of another period in a one-file-per-period family', () => {
  it.each([
    ['매출_2026-08.xlsx', '매출_2026-09.xlsx'],
    ['sales_202608_v2.csv', 'sales_202609_v2.csv'],
    ['2026/8월 매출.csv', '2026/9월 매출.csv'],
    ['매출 8월.xlsx', '매출 9월.xlsx'],
    ['orders-2608.xlsx', 'orders-2609.xlsx'],
    ['2026-08-31 마감.xlsx', '2026-09-31 마감.xlsx'],
  ])('%s -> %s', (from, to) => {
    expect(periodFilePath(from, august, september)).toBe(to);
  });

  it('crosses into the next year', () => {
    expect(periodFilePath('매출_2026-12.xlsx', period('2026-12-01'), period('2027-01-01'))).toBe('매출_2027-01.xlsx');
  });

  it('keeps the example file for the example period', () => {
    expect(periodFilePath('매출.xlsx', august, august)).toBe('매출.xlsx');
  });

  it('refuses a name that does not show its period', () => {
    expect(() => periodFilePath('매출.xlsx', august, september)).toThrow('report_file_period_name_unknown');
    expect(() => periodFilePath('report_v3.xlsx', august, september)).toThrow('report_file_period_name_unknown');
  });
});
