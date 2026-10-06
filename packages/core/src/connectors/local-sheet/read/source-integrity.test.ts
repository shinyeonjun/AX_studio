import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { TableArtifactSchema } from '../../../contracts/artifacts/table.js';
import { WorkbookArtifactSchema } from '../../../contracts/artifacts/workbook.js';
import { evaluateTransformExpr } from '../../../workflow/transform-expr/evaluator.js';
import { readXlsxWorkbook } from './xlsx.js';

function workbookBytes(sheets: { name: string; rows: unknown[][]; origin?: string }[]): Uint8Array {
  const workbook = XLSX.utils.book_new();
  for (const { name, rows, origin } of sheets) {
    const sheet: XLSX.WorkSheet = {};
    const start = XLSX.utils.decode_cell(origin ?? 'A1');
    XLSX.utils.sheet_add_aoa(sheet, rows, { origin: start });
    sheet['!ref'] = XLSX.utils.encode_range({
      s: start,
      e: { r: start.r + rows.length - 1, c: start.c + Math.max(...rows.map((row) => row.length)) - 1 },
    });
    XLSX.utils.book_append_sheet(workbook, sheet, name);
  }
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Uint8Array;
}

function read(data: Uint8Array, rowLimit = 5_000) {
  const contentHash = createHash('sha256').update(data).digest('hex');
  return readXlsxWorkbook({
    path: '/synthetic/source-integrity.xlsx',
    rowLimit,
    workbookId: `wb_${contentHash.slice(0, 16)}`,
    file: { path: '/synthetic/source-integrity.xlsx', name: 'source-integrity.xlsx' },
    data,
  });
}

function firstTable(data: Uint8Array, rowLimit?: number) {
  return TableArtifactSchema.parse(Object.values(read(data, rowLimit).tables)[0]);
}

describe('XLSX source integrity', () => {
  it('preserves raw strings and blanks alongside the existing numeric calculation values', () => {
    const data = workbookBytes([{
      name: 'Data',
      rows: [
        ['id', 'amount', 'literalNA', 'literalNULL', 'note', 'empty', 'missing'],
        ['00123', '1,234.50', 'NA', 'NULL', '  keep both spaces  ', '', null],
      ],
    }]);
    const table = firstTable(data);
    expect(table.rows[0]?.values).toEqual({
      id: '00123', amount: 1234.5, literalNA: 'NA', literalNULL: 'NULL',
      note: 'keep both spaces', empty: null, missing: null,
    });
    expect(table.rows[0]?.rawValues).toEqual({
      id: '00123', amount: '1,234.50', literalNA: 'NA', literalNULL: 'NULL',
      note: '  keep both spaces  ', empty: '', missing: null,
    });
  });

  it('keeps physical rows and columns from a non-A1 range, including fully blank data rows', () => {
    const data = workbookBytes([{
      name: 'Offset', origin: 'C5',
      rows: [['id', 'amount'], ['00123', 4], [null, null], ['00123', 2]],
    }]);
    const table = firstTable(data);
    expect(table.source).toMatchObject({ workbookSheet: 'Offset', headerRow: 5 });
    expect(table.columns.map(({ sourceColumn }) => sourceColumn)).toEqual([3, 4]);
    expect(table.rows.map(({ index, sourceRow }) => ({ index, sourceRow }))).toEqual([
      { index: 0, sourceRow: 6 }, { index: 1, sourceRow: 7 }, { index: 2, sourceRow: 8 },
    ]);
    expect(table.rows[1]?.rawValues).toEqual({ id: null, amount: null });
    expect(table.rows[0]?.key).toMatch(/^row_[a-f0-9]{64}$/);
    expect(new Set(table.rows.map(({ key }) => key)).size).toBe(3);
  });

  it('binds stable row keys to the source bytes, sheet and physical row', () => {
    const data = workbookBytes([
      { name: 'First', rows: [['id'], ['duplicate'], ['duplicate']] },
      { name: 'Second', rows: [['id'], ['duplicate']] },
    ]);
    const first = read(data);
    const repeated = read(data);
    const rows = Object.values(first.tables).flatMap(({ rows }) => rows);
    expect(rows.every(({ key }) => typeof key === 'string')).toBe(true);
    expect(new Set(rows.map(({ key }) => key)).size).toBe(3);
    expect(Object.values(repeated.tables).flatMap(({ rows }) => rows.map(({ key }) => key)))
      .toEqual(rows.map(({ key }) => key));
    expect(Object.values(first.tables)[0]?.source?.contentHash)
      .toBe(createHash('sha256').update(data).digest('hex'));
    const changed = workbookBytes([
      { name: 'First', rows: [['id'], ['duplicate'], ['changed']] },
      { name: 'Second', rows: [['id'], ['duplicate']] },
    ]);
    expect(firstTable(changed).rows[0]?.key).not.toBe(rows[0]?.key);
  });

  it.each([
    { count: 0, limit: 2, truncated: false },
    { count: 1, limit: 2, truncated: false },
    { count: 2, limit: 2, truncated: false },
    { count: 3, limit: 2, truncated: true },
    { count: 8, limit: 2, truncated: true },
  ])('marks $count data rows at limit $limit truthfully', ({ count, limit, truncated }) => {
    const data = workbookBytes([{
      name: 'Bounded', origin: 'C5',
      rows: [['amount'], ...Array.from({ length: count }, (_, index) => [index + 1])],
    }]);
    const table = firstTable(data, limit);
    expect(table.rows).toHaveLength(Math.min(count, limit));
    expect(table.truncated).toBe(truncated);
    expect(table.completeness).toEqual(truncated
      ? { status: 'partial', reason: 'row_limit', observedCount: limit, limit, hasMore: true }
      : { status: 'complete', observedCount: count, hasMore: false });
  });

  it('normalizes row limits consistently before deciding whether source rows are omitted', () => {
    const data = workbookBytes([{ name: 'Bounded', rows: [['amount'], [1], [2]] }]);
    for (const limit of [0, -1, 1.8]) {
      const table = firstTable(data, limit);
      expect(table.rows).toHaveLength(1);
      expect(table.completeness).toMatchObject({ status: 'partial', limit: 1, hasMore: true });
    }
    expect(firstTable(data, Number.NaN).completeness?.status).toBe('complete');
  });

  it('rejects whole-source aggregation when the XLSX reader omitted rows', () => {
    const data = workbookBytes([{ name: 'Partial', rows: [['amount'], [10], [20], [30]] }]);
    const table = firstTable(data, 2);
    expect(() => evaluateTransformExpr(
      { op: 'aggregate', input: { op: 'source', sourceId: 'input' }, fn: 'sum', column: 'amount' },
      { input: table },
    )).toThrow('incomplete_table_input');
  });

  it('preserves raw values and physical identity through filtering, sorting and projection', () => {
    const data = workbookBytes([{
      name: 'Data', rows: [['id', 'amount', 'note'], ['00123', '10', ' private '], ['00123', '20', ' other ']],
    }]);
    const table = firstTable(data);
    const output = evaluateTransformExpr({
      op: 'select', columns: ['id', 'amount'], input: {
        op: 'sort', by: [{ column: 'amount', direction: 'desc' }], input: {
          op: 'filter', input: { op: 'source', sourceId: 'input' },
          where: { op: 'gte', left: { ref: 'amount' }, right: { lit: 10 } },
        },
      },
    }, { input: table });
    expect(output).toMatchObject({ rows: [
      { index: 0, key: table.rows[1]?.key, sourceRow: 3, rawValues: { id: '00123', amount: '20' } },
      { index: 1, key: table.rows[0]?.key, sourceRow: 2, rawValues: { id: '00123', amount: '10' } },
    ] });
    if (typeof output === 'object' && output && 'rows' in output) {
      expect(output.rows[0]?.rawValues).not.toHaveProperty('note');
    }
    expect(evaluateTransformExpr(
      { op: 'aggregate', input: { op: 'source', sourceId: 'input' }, fn: 'sum', column: 'amount' },
      { input: table },
    )).toBe(30);
  });

  it('discloses omitted sheets at the workbook sheet cap', () => {
    const data = workbookBytes(Array.from({ length: 21 }, (_, index) => ({
      name: `Sheet${index + 1}`, rows: [['amount'], [1]],
    })));
    const workbook = WorkbookArtifactSchema.parse(read(data).workbook);
    expect(workbook.sheets).toHaveLength(20);
    expect(workbook.completeness).toEqual({
      status: 'partial', reason: 'provider_limit', observedCount: 20, limit: 20, hasMore: true,
    });
  });

  it('does not claim the workbook is complete if any retained sheet has omitted rows', () => {
    const data = workbookBytes([
      { name: 'Complete', rows: [['amount'], [1]] },
      { name: 'Partial', rows: [['amount'], [1], [2], [3]] },
    ]);
    const result = read(data, 2);
    expect(WorkbookArtifactSchema.parse(result.workbook).completeness)
      .toEqual({ status: 'partial', reason: 'row_limit', hasMore: true });
    expect(Object.values(result.tables).map(({ completeness }) => completeness?.status))
      .toEqual(['complete', 'partial']);
  });

  it('marks a fully retained workbook complete at the exact sheet cap', () => {
    const data = workbookBytes(Array.from({ length: 20 }, (_, index) => ({
      name: `Sheet${index + 1}`, rows: [['amount'], [1]],
    })));
    expect(WorkbookArtifactSchema.parse(read(data).workbook).completeness)
      .toEqual({ status: 'complete', hasMore: false });
  });
});
