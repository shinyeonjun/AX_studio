import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { fileFamilyPattern, newestFileInFamily } from './newest-file.js';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function folder(files: Array<[name: string, daysAgo: number]>, sub = ''): string {
  const root = mkdtempSync(join(tmpdir(), 'ax-newest-'));
  roots.push(root);
  mkdirSync(join(root, sub), { recursive: true });
  for (const [name, daysAgo] of files) {
    const path = join(root, sub, name);
    writeFileSync(path, 'x');
    const at = (Date.now() - daysAgo * 86_400_000) / 1000;
    utimesSync(path, at, at);
  }
  return root;
}

describe('the file a recurring report reads', () => {
  it.each([
    ['주문내역_2026-08.xlsx', [['주문내역_2026-08.xlsx', 40], ['주문내역_2026-09.xlsx', 5], ['주문내역_요약.xlsx', 1], ['매출_2026-10.xlsx', 0]], '주문내역_2026-09.xlsx'],
    ['sales_q3_v2.csv', [['sales_q3_v2.csv', 90], ['sales_q4_v1.csv', 2], ['sales_q4_v1.xlsx', 1]], 'sales_q4_v1.csv'],
    ['report.xlsx', [['report.xlsx', 30], ['report (1).xlsx', 1]], 'report.xlsx'],
    ['2026년 8월 매출.xlsx', [['2026년 8월 매출.xlsx', 40], ['2026년 10월 매출.xlsx', 3], ['~$2026년 11월 매출.xlsx', 0]], '2026년 10월 매출.xlsx'],
  ] as const)('%s → the newest file named the same way', (example, files, expected) => {
    const root = folder(files as unknown as Array<[string, number]>, 'exports');
    expect(newestFileInFamily(root, join('exports', example))).toBe(join('exports', expected));
  });

  it('keeps the example when its folder is gone or nothing matches', () => {
    const root = folder([['other.xlsx', 0]]);
    expect(newestFileInFamily(root, join('missing', 'a_1.xlsx'))).toBe(join('missing', 'a_1.xlsx'));
    expect(newestFileInFamily(root, 'a_1.xlsx')).toBe('a_1.xlsx');
  });

  it('only lets digit runs vary', () => {
    const pattern = fileFamilyPattern('주문(내역)_2026.08.xlsx');
    expect(pattern.test('주문(내역)_2027.11.xlsx')).toBe(true);
    expect(pattern.test('주문(내역)_2027-11.xlsx')).toBe(false);
    expect(pattern.test('주문(내역)_2027.11.xlsx.bak')).toBe(false);
  });
});
