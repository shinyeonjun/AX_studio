import { describe, expect, it } from 'vitest';
import type { PdfReportPairAnalysis } from '../../../read/types/pdf.js';
import { repairExampleReplayInference } from '../replay-repair.js';

describe('a difference with the opposite sign of the example', () => {
  it('runs its subtraction the other way round', () => {
    const pair = {
      schemaVersion: 1, pairId: 'p', templateHash: 't', exampleHash: 'e', pageCount: 1,
      pages: [{ index: 0, width: 595, height: 842, rotation: 0 }],
      scalarSlots: [{ id: 'net', pageIndex: 0, rect: { x: 0, y: 0, width: 1, height: 1 }, exampleText: '-4', fontSize: 10, font: '', color: 0 }],
      tableGroups: [], templateImages: [], exampleImages: [],
    } as PdfReportPairAnalysis;
    const field = (path: string) => ({ kind: 'field' as const, path });
    const where = (kind: string) => ({ kind: 'compare', operation: 'eq', left: field('m.kind'), right: { kind: 'literal', value: kind } });
    const repaired = repairExampleReplayInference({
      pair, metadata: {},
      sources: { m: { id: 'm', complete: true, rows: [{ kind: 'in', q: 3 }, { kind: 'out', q: 7 }] } },
      plan: {
        schemaVersion: 1, baseSource: 'm', joins: [], tables: [], texts: [],
        scalars: [{ id: 'net', format: { style: 'integer' }, expression: { kind: 'arithmetic', operation: 'subtract',
          left: { kind: 'sum', value: field('m.q'), where: where('out') }, right: { kind: 'sum', value: field('m.q'), where: where('in') } } }],
      } as never,
      layout: { schemaVersion: 1, outputFileName: 'r', tableBindings: [], scalarBindings: [{ slotId: 'net', value: { kind: 'scalar', id: 'net' } }] },
    });
    expect(repaired.executionError).toBeUndefined();
    expect(repaired.mismatches).toEqual([]);
  });
});
