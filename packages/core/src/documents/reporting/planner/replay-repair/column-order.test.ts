import { describe, expect, it } from 'vitest';
import type { PdfReportPairAnalysis } from '../../../read/types/pdf.js';
import { repairExampleReplayInference } from '../replay-repair.js';

const cell = (id: string, exampleText: string) => ({ id, pageIndex: 0, rect: { x: 0, y: 0, width: 1, height: 1 }, exampleText, fontSize: 10, font: '', color: 0 });

describe('two table columns bound the wrong way round', () => {
  it('are swapped when the example then replays', () => {
    const pair = {
      schemaVersion: 1, pairId: 'p', templateHash: 't', exampleHash: 'e', pageCount: 1, pages: [{ index: 0, width: 595, height: 842, rotation: 0 }], scalarSlots: [],
      tableGroups: [{ id: 'g', columnCount: 2, rowCount: 1, rows: [{ index: 0, pageIndex: 0, y: 0, cells: [cell('in', '3'), cell('out', '7')] }] }],
      templateImages: [], exampleImages: [],
    } as PdfReportPairAnalysis;
    const field = (path: string) => ({ kind: 'field' as const, path });
    const repaired = repairExampleReplayInference({
      pair, metadata: {},
      sources: { m: { id: 'm', complete: true, rows: [{ w: 'A', kind: 'in', q: 3 }, { w: 'A', kind: 'out', q: 7 }] } },
      plan: {
        schemaVersion: 1, baseSource: 'm', joins: [], scalars: [], texts: [],
        tables: [{ kind: 'aggregate', id: 't', groupBy: [{ id: 'w', value: field('m.w') }], columns: [
          { id: 'inbound', value: { kind: 'aggregate', expression: { kind: 'sum', value: field('m.q'), where: { kind: 'compare', operation: 'eq', left: field('m.kind'), right: { kind: 'literal', value: 'in' } } } } },
          { id: 'outbound', value: { kind: 'aggregate', expression: { kind: 'sum', value: field('m.q'), where: { kind: 'compare', operation: 'eq', left: field('m.kind'), right: { kind: 'literal', value: 'out' } } } } },
        ] }],
      } as never,
      layout: { schemaVersion: 1, outputFileName: 'r', scalarBindings: [], tableBindings: [{ groupId: 'g', tableId: 't', columns: [
        { columnIndex: 0, columnId: 'outbound' }, { columnIndex: 1, columnId: 'inbound' },
      ] }] },
    });
    expect(repaired.executionError).toBeUndefined();
    expect(repaired.mismatches).toEqual([]);
    expect(repaired.layout.tableBindings[0]!.columns).toEqual([{ columnIndex: 0, columnId: 'inbound' }, { columnIndex: 1, columnId: 'outbound' }]);
  });
});
