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

  it('goes by the period in the name, so re-saving last month does not make it this month', () => {
    const root = folder([['주문내역_2026-09.xlsx', 3], ['주문내역_2026-08.xlsx', 0]]);
    expect(newestFileInFamily(root, '주문내역_2026-08.xlsx')).toBe('주문내역_2026-09.xlsx');
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

describe('a learned rule over a file with a long Korean path', () => {
  it('can be saved: its source id is not cut at 200 characters', async () => {
    const { OutputContractSchema } = await import('../../contracts/output-contract.js');
    const sourceId = `sheet:${encodeURIComponent('업무자료')}:${encodeURIComponent('월간 보고/2026년 주문내역_서울지점_최종본_수정.xlsx')}`;
    expect(sourceId.length).toBeGreaterThan(200);
    expect(OutputContractSchema.safeParse({ inputSchemas: [{ sourceId, stepId: 's1' }] }).success).toBe(true);
  });
});

describe('a saved monthly report run', () => {
  it('reads this month even though the workflow stored the example as an absolute path', async () => {
    const { LocalSheetConnector } = await import('./connector.js');
    const root = folder([['주문내역_2026-08.csv', 40], ['주문내역_2026-09.csv', 5]], '주문내역');
    writeFileSync(join(root, '주문내역', '주문내역_2026-08.csv'), 'amount\n1\n');
    writeFileSync(join(root, '주문내역', '주문내역_2026-09.csv'), 'amount\n1\n2\n');
    const log: Array<{ code?: string; data?: unknown }> = [];
    const result = await new LocalSheetConnector().execute('read', {
      path: join(root, '주문내역', '주문내역_2026-08.csv'),
      folderId: 'f1',
      followNewest: true,
    }, {
      executionId: 'e1',
      variables: {},
      log: (entry: { code?: string; data?: unknown }) => log.push(entry),
      connections: [{ connector: 'local_folder', connected: true, config: { folders: [{ id: 'f1', path: root }] } }],
    } as never);
    expect(result.ok).toBe(true);
    expect((result as { data: { rows: unknown[] } }).data.rows).toHaveLength(2);
    expect(log.find((entry) => entry.code === 'sheet_source_resolved')?.data).toEqual({ fileName: '주문내역_2026-09.csv' });
  });
});
