import { describe, expect, it } from 'vitest';
import { TableArtifactSchema } from './table.js';
import { profileTable, tableArtifactFromRows } from './table-build.js';
import { buildTableArtifact } from '../../connectors/local-sheet/profile.js';

describe('TableArtifact', () => {
  it('validates structured table rows and profile', () => {
    const artifact = buildTableArtifact({
      id: 'tbl_test',
      name: 'sales',
      headers: ['amount', 'week'],
      matrix: [[1000, '2026-W01'], [500, '2026-W02']],
    });
    expect(TableArtifactSchema.parse(artifact)).toMatchObject({
      kind: 'table',
      columns: expect.arrayContaining([
        expect.objectContaining({ name: 'amount', type: 'integer' }),
      ]),
      rows: expect.arrayContaining([
        expect.objectContaining({ index: 0, values: { amount: 1000, week: '2026-W01' } }),
      ]),
      profile: expect.objectContaining({ rowCount: 2, columnCount: 2 }),
    });
  });

  it('preserves optional page metadata for bounded connector reads', () => {
    const artifact = {
      ...buildTableArtifact({
        id: 'tbl_page',
        headers: ['id'],
        matrix: [[1]],
        rowLimit: 1,
      }),
      offset: 1,
      nextOffset: 2,
    };

    expect(TableArtifactSchema.parse(artifact)).toMatchObject({ offset: 1, nextOffset: 2 });
  });

  it('profiles extrema using scalar value order', () => {
    const artifact = buildTableArtifact({
      id: 'tbl_extrema',
      headers: ['amount', 'date', 'mixed'],
      matrix: [[10, '2026-10-01', 'text'], [2, '2026-02-01', 3]],
    });

    expect(artifact.profile?.columns.amount).toMatchObject({ min: 2, max: 10 });
    expect(artifact.profile?.columns.date).toMatchObject({ min: '2026-02-01', max: '2026-10-01' });
    expect(artifact.profile?.columns.mixed).toMatchObject({ min: undefined, max: undefined });
  });

  it('preserves values from duplicate and blank headers under unique column names', () => {
    const artifact = buildTableArtifact({
      id: 'tbl_duplicate_headers',
      headers: ['amount', 'amount', 'amount_2', '', 'column_4'],
      matrix: [[10, 20, 30, 40, 50]],
    });

    expect(artifact.columns.map((column) => column.name)).toEqual([
      'amount', 'amount_3', 'amount_2', 'column_4', 'column_4_2',
    ]);
    expect(artifact.rows[0]?.values).toEqual({
      amount: 10, amount_3: 20, amount_2: 30, column_4: 40, column_4_2: 50,
    });
    expect(artifact.profile?.columnCount).toBe(5);
  });

  it('preserves row-object column order and rejects malformed or sparse row arrays', () => {
    const artifact = tableArtifactFromRows(
      [{ second: 2, first: 1 }, { first: 3, third: 4 }],
      { id: 'tbl_rows' },
    );

    expect(artifact?.columns.map((column) => column.name)).toEqual(['second', 'first', 'third']);
    expect(artifact?.rows.map((row) => row.values)).toEqual([
      { second: 2, first: 1, third: null },
      { second: null, first: 3, third: 4 },
    ]);
    expect(tableArtifactFromRows([{ id: 1 }, null], { id: 'tbl_invalid' })).toBeUndefined();
    const sparse: Record<string, unknown>[] = [];
    sparse[1] = { id: 2 };
    expect(tableArtifactFromRows(sparse, { id: 'tbl_sparse' })).toBeUndefined();
  });

  it('preserves nested API values as JSON and treats missing cells as null', () => {
    const artifact = buildTableArtifact({
      id: 'tbl_nested_values',
      headers: ['dimensions', 'warranty', 'missing'],
      matrix: [[{ width: 10, height: 20 }, ['fragile', 'keep dry'], undefined]],
    });

    expect(artifact.rows[0]?.values).toEqual({
      dimensions: '{"width":10,"height":20}',
      warranty: '["fragile","keep dry"]',
      missing: null,
    });
  });

  it('preserves profile statistics for null, mixed, and non-finite scalar values', () => {
    const columns = [
      { name: 'amount', type: 'number' as const, nullable: true, inferred: false },
      { name: 'label', type: 'string' as const, nullable: true, inferred: false },
      { name: 'mixed', type: 'unknown' as const, nullable: true, inferred: false },
    ];
    const rows = [
      { index: 0, values: { amount: 1, label: 'repeat', mixed: 'one' } },
      { index: 1, values: { amount: null, label: 'repeat', mixed: 2 } },
      { index: 2, values: { amount: 5, label: 'other', mixed: 'one' } },
      { index: 3, values: { amount: null, label: null, mixed: null } },
    ];

    const profile = profileTable(columns, rows);

    expect(profile.columns.amount).toEqual({
      nullCount: 2, distinctCount: 2, min: 1, max: 5, mean: 3, sampleValues: [1, 5],
    });
    expect(profile.columns.label).toMatchObject({ nullCount: 1, distinctCount: 2, min: 'other', max: 'repeat' });
    expect(profile.columns.mixed).toMatchObject({ nullCount: 1, distinctCount: 2, min: undefined, max: undefined, mean: 2 });

    const nonFinite = profileTable(
      [{ name: 'value', type: 'number', nullable: true, inferred: false }],
      [{ index: 0, values: { value: Number.POSITIVE_INFINITY } }, { index: 1, values: { value: Number.NEGATIVE_INFINITY } }],
    ).columns.value;
    expect(nonFinite).toMatchObject({ distinctCount: 1, min: Number.NEGATIVE_INFINITY, max: Number.POSITIVE_INFINITY });
    expect(Number.isNaN(nonFinite.mean)).toBe(true);
  });
});
