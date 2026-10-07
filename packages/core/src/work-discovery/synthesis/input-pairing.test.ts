import { describe, expect, it } from 'vitest';
import { buildTableArtifact } from '../../contracts/artifacts/table-build.js';
import type { TableArtifact } from '../../contracts/artifacts/table.js';
import type { SourceDescriptor } from '../schema.js';
import { inputPairings } from './input-pairing.js';

const orders = (id: string, rows: number) =>
  buildTableArtifact({ id, headers: ['date', 'amount'], matrix: Array.from({ length: rows }, (_, index) => ['2026-08-01', index]) });
const prices = buildTableArtifact({ id: 'prices', headers: ['item', 'price'], matrix: [['a', 1]] });
const source = (id: string, label: string): SourceDescriptor =>
  ({ id, connector: 'input_artifact', label, kind: 'workbook', relevance: 0.9 }) as SourceDescriptor;

/** Rows each example reads under each source id, per returned option. */
function shape(options: ReturnType<typeof inputPairings>): Array<Record<string, Record<string, number>>> {
  return options.map((option) => Object.fromEntries(Object.entries(option.snapshotsByExample)
    .map(([exampleId, tables]) => [exampleId, Object.fromEntries(Object.entries(tables).map(([id, table]) => [id, table.rows.length]))])));
}

describe('which file each example reads', () => {
  const aug = orders('aug', 3);
  const sep = orders('sep', 2);
  const everyFileForEveryExample = (tables: Record<string, TableArtifact>) => ({ ex1: { ...tables }, ex2: { ...tables } });

  it('tries the pairing the names point to first: _08 with _08', () => {
    const options = inputPairings({
      examples: [{ id: 'ex1', outputNames: ['매출보고서_2026-09.pdf'] }, { id: 'ex2', outputNames: ['매출보고서_2026-08.pdf'] }],
      sources: [source('a', '주문내역_2026-08.xlsx'), source('s', '주문내역_2026-09.xlsx'), source('p', '단가표.xlsx')],
      snapshotsByExample: everyFileForEveryExample({ a: aug, s: sep, p: prices }),
    });
    expect(shape(options)[0]).toEqual({ ex1: { s: 2, p: 1 }, ex2: { s: 3, p: 1 } });
    expect(options[0]!.bindings).toEqual([{ exampleId: 'ex2', sharedId: 's', sourceId: 'a' }]);
    // Then as given, then the other pairing.
    expect(shape(options).slice(1)).toEqual([
      { ex1: { a: 3, s: 2, p: 1 }, ex2: { a: 3, s: 2, p: 1 } },
      { ex1: { a: 3, p: 1 }, ex2: { a: 2, p: 1 } },
    ]);
  });

  it('keeps "as given" first when names say nothing, so two same-shaped branch files used together still work', () => {
    const options = inputPairings({
      examples: [{ id: 'ex1', outputNames: ['report.pdf'] }, { id: 'ex2', outputNames: ['report (1).pdf'] }],
      sources: [source('a', '강남점.xlsx'), source('s', '홍대점.xlsx')],
      snapshotsByExample: everyFileForEveryExample({ a: aug, s: sep }),
    });
    expect(options[0]!.bindings).toEqual([]);
    expect(options).toHaveLength(3);
  });

  it('pairs the files each example was given, and leaves one shared file alone', () => {
    const options = inputPairings({
      examples: [{ id: 'ex1', outputNames: [] }, { id: 'ex2', outputNames: [] }],
      sources: [source('a', 'x.xlsx'), source('s', 'y.xlsx'), source('p', 'p.xlsx')],
      snapshotsByExample: { ex1: { a: aug, p: prices }, ex2: { s: sep, p: prices } },
    });
    expect(shape(options)).toEqual([
      { ex1: { a: 3, p: 1 }, ex2: { a: 2, p: 1 } },
      { ex1: { a: 3, p: 1 }, ex2: { s: 2, p: 1 } },
    ]);
  });

  it('picks each example its month out of a folder of many months', () => {
    const months = Object.fromEntries(Array.from({ length: 12 }, (_, index) => [`m${index + 1}`, orders(`m${index + 1}`, index + 1)]));
    const options = inputPairings({
      examples: [{ id: 'ex1', outputNames: ['요약_2026-08.xlsx'] }, { id: 'ex2', outputNames: ['요약_2026-09.xlsx'] }, { id: 'ex3', outputNames: ['요약_2026-10.xlsx'] }],
      sources: Object.keys(months).map((id, index) => source(id, `주문내역_2026-${String(index + 1).padStart(2, '0')}.xlsx`)),
      snapshotsByExample: { ex1: { ...months }, ex2: { ...months }, ex3: { ...months } },
    });
    expect(shape(options)[0]).toEqual({ ex1: { m8: 8 }, ex2: { m8: 9 }, ex3: { m8: 10 } });
  });

  it('changes nothing for a single example', () => {
    const snapshotsByExample = { ex1: { a: aug, s: sep } };
    expect(inputPairings({ examples: [{ id: 'ex1', outputNames: [] }], sources: [], snapshotsByExample }))
      .toEqual([{ snapshotsByExample, bindings: [] }]);
  });
});
