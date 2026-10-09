import { describe, expect, it, vi } from 'vitest';
import type { DecisionEngine, DecisionEvaluationRequest } from '../../../contracts/decision.js';
import type { PdfReportPairAnalysis } from '../../read/types/pdf.js';
import { inferReportSourceRequirements } from './source-requirements.js';

const pair = { schemaVersion: 1, pairId: 'p', templateHash: 't', exampleHash: 'e', pageCount: 1, pages: [],
  scalarSlots: [], tableGroups: [], templateImages: [], exampleImages: [] } as unknown as PdfReportPairAnalysis;

describe('choosing which kinds of source a report needs', () => {
  it('shows each source by what it holds, by name only, so a folder of order files can be chosen', async () => {
    let seen: DecisionEvaluationRequest | undefined;
    const decisionEngine: DecisionEngine = { evaluate: vi.fn(async (request: DecisionEvaluationRequest) => {
      seen = request;
      return { answers: {
        file_required: { type: 'choice' as const, choice: 'required', probabilities: { required: 0.9 }, confidence: 0.9 },
        rdb_required: { type: 'choice' as const, choice: 'not_required', probabilities: { not_required: 0.9 }, confidence: 0.9 },
      } };
    }) };
    const needs = await inferReportSourceRequirements(decisionEngine, {
      goal: '지난달 보고서야. 이번 달 걸로 써 줘', pair, connectedConnectors: ['document', 'rdb', 'file'],
      sourceNames: { rdb: ['public.customers'], file: ['월간매출/주문내역_2026-08.xlsx', '월간매출/주문내역_2026-09.xlsx'] },
    });
    expect((seen!.questions.file_required!.instructions as { contains?: string[] }).contains)
      .toEqual(['월간매출/주문내역_2026-08.xlsx', '월간매출/주문내역_2026-09.xlsx']);
    expect((seen!.questions.rdb_required!.instructions as { contains?: string[] }).contains).toEqual(['public.customers']);
    expect(needs.map((need) => need.connector)).toEqual(['file']);
  });
});
