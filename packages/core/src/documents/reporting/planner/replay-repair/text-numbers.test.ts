import { describe, expect, it } from 'vitest';
import type { PdfReportPairAnalysis } from '../../../read/types/pdf.js';
import { repairExampleReplayInference } from '../replay-repair.js';

describe('a number inside a sentence', () => {
  it('is written the way the sentence writes it', () => {
    const pair = {
      schemaVersion: 1, pairId: 'p', templateHash: 't', exampleHash: 'e', pageCount: 1,
      pages: [{ index: 0, width: 595, height: 842, rotation: 0 }],
      scalarSlots: [{ id: 's', pageIndex: 0, rect: { x: 0, y: 0, width: 1, height: 1 }, exampleText: '총매출은 8,466,900원이며', fontSize: 10, font: '', color: 0 }],
      tableGroups: [], templateImages: [], exampleImages: [],
    } as PdfReportPairAnalysis;
    const repaired = repairExampleReplayInference({
      pair, metadata: {},
      sources: { o: { id: 'o', complete: true, rows: [{ amount: 8_000_000 }, { amount: 466_900 }] } },
      plan: {
        schemaVersion: 1, baseSource: 'o', joins: [], tables: [],
        scalars: [{ id: 'total', expression: { kind: 'sum', value: { kind: 'field', path: 'o.amount' } }, format: { style: 'currency', currency: 'KRW' } }],
        texts: [{ id: 'line', kind: 'computed', template: '총매출은 {{scalar.total}}원이며' }],
      } as never,
      layout: { schemaVersion: 1, outputFileName: 'r', tableBindings: [], scalarBindings: [{ slotId: 's', value: { kind: 'text', id: 'line' } }] },
    });
    expect(repaired.executionError).toBeUndefined();
    expect(repaired.mismatches).toEqual([]);
  });
});
