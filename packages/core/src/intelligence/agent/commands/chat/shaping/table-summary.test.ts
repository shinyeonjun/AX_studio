import { describe, expect, it } from 'vitest';
import type { DecisionAnswer, DecisionEngine, DecisionQuestion } from '../../../../../contracts/decision.js';
import { buildTableArtifact } from '../../../../../contracts/artifacts/table-build.js';
import { summarizeTable, summaryConditionCandidates } from './table-summary.js';
import { applyJevTableTransform } from './table-transform/index.js';

const orders = buildTableArtifact({
  id: 'orders',
  headers: ['ordered_at', 'region', 'amount', 'status'],
  matrix: [
    ['2026-08-30', '서울', 100, '완료'],
    ['2026-09-01', '서울', 200, '완료'],
    ['2026-09-02', '부산', 300, '완료'],
    ['2026-09-03', '부산', 400, '취소'],
    ['2026-09-04', '대구', 500, '완료'],
    ['2026-10-01', '서울', 600, '완료'],
    ['2026-09-05', '서울 ', 50, '완료'],
  ],
});

const choice = (value: string): DecisionAnswer => ({ type: 'choice', choice: value, probabilities: { [value]: 0.99 }, confidence: 0.99 });

/** Answers like a model would: picks by the descriptions the host offered, never invents. */
function engine(pick: {
  fn: string;
  column?: string;
  group?: string;
  conditions: readonly string[];
}): DecisionEngine & { asked: Record<string, DecisionQuestion> } {
  const result = {
    asked: {} as Record<string, DecisionQuestion>,
    evaluate: async (request: { questions: Record<string, DecisionQuestion> }) => {
      result.asked = request.questions;
      const columnChoice = (id: string, name?: string) => {
        const question = request.questions[id];
        const criteria = question?.type === 'choice' ? question.criteria : {};
        return Object.entries(criteria).find(([, value]) => typeof value === 'object' && value && 'field' in value && value.field === name)?.[0] ?? 'none';
      };
      const answers: Record<string, DecisionAnswer> = {
        summary_function: choice(pick.fn),
        summary_column: choice(columnChoice('summary_column', pick.column)),
        group_column: choice(columnChoice('group_column', pick.group)),
      };
      for (const [id, question] of Object.entries(request.questions)) {
        if (!id.startsWith('condition_') || question.type !== 'boolean') continue;
        const text = typeof question.instructions === 'string' ? question.instructions : String(question.instructions.statement ?? question.instructions.question ?? '');
        answers[id] = { type: 'boolean', probability: pick.conditions.some((condition) => text.includes(condition)) ? 0.95 : 0.05 };
      }
      return { answers };
    },
  };
  return result;
}

describe('what a request can restrict', () => {
  it('offers only values that are in both the table and the request', () => {
    const descriptions = summaryConditionCandidates(orders, '2026년 9월 완료된 주문 매출 합계').map((condition) => condition.description);
    expect(descriptions).toEqual(['status = 완료', 'status ≠ 완료', 'ordered_at: 2026년 9월']);
    // A month without a year matches that month of any year in the data; a number is a threshold.
    expect(summaryConditionCandidates(orders, '9월에 amount 300 이상').map((condition) => condition.description))
      .toEqual(['ordered_at: 2026년 9월', 'amount ≥ 300', 'amount ≤ 300', 'amount > 300', 'amount < 300']);
  });
});

describe('a computed answer from a read table', () => {
  it('totals only the rows the request names, computed by the host', async () => {
    const result = await summarizeTable({
      decisionEngine: engine({ fn: 'sum', column: 'amount', conditions: ['status = 완료', 'ordered_at: 2026년 9월'] }),
      table: orders,
      userMessage: '2026년 9월 완료된 주문 매출 합계',
    });
    expect(result).toMatchObject({ status: 'transformed' });
    if (result.status !== 'transformed') return;
    expect(result.table.rows.map((row) => row.values)).toEqual([{ 'amount 합계': 1050 }]);
    expect(result.table.name).toBe('amount 합계 · 조건: status = 완료, ordered_at: 2026년 9월');
  });

  it('breaks a count down per group, largest first, and treats two values of one column as either', async () => {
    const result = await summarizeTable({
      decisionEngine: engine({ fn: 'count', group: 'region', conditions: ['status = 완료'] }),
      table: orders,
      userMessage: '완료된 주문을 지역별로 몇 건인지',
    });
    expect(result.status === 'transformed' && result.table.rows.map((row) => row.values)).toEqual([
      { region: '서울', 건수: 4 }, { region: '부산', 건수: 1 }, { region: '대구', 건수: 1 },
    ]);
    const either = await summarizeTable({
      decisionEngine: engine({ fn: 'sum', column: 'amount', conditions: ['region = 서울', 'region = 부산'] }),
      table: orders,
      userMessage: '서울하고 부산 매출 합계',
    });
    expect(either.status === 'transformed' && either.table.rows[0]!.values).toEqual({ 'amount 합계': 1650 });
  });

  it('refuses to total a table that is not the whole data, or contradicting conditions', async () => {
    const partial = { ...orders, truncated: true };
    expect(await summarizeTable({ decisionEngine: engine({ fn: 'sum', column: 'amount', conditions: [] }), table: partial, userMessage: '매출 합계' }))
      .toMatchObject({ status: 'clarify', message: expect.stringContaining('전체가 아니어서') });
    expect(await summarizeTable({
      decisionEngine: engine({ fn: 'count', conditions: ['status = 완료', 'status ≠ 완료'] }), table: orders, userMessage: '완료 주문 건수, 완료 제외',
    })).toMatchObject({ status: 'clarify' });
  });

  it('is what the table transform does when the request asks for a number', async () => {
    const result = await applyJevTableTransform({
      decisionEngine: engine({ fn: 'avg', column: 'amount', conditions: [] }),
      table: orders,
      userMessage: '평균 주문 금액',
      mode: 'calculate',
    });
    expect(result.status === 'transformed' && result.table.rows[0]!.values).toEqual({ 'amount 평균': 2150 / 7 });
  });
});
