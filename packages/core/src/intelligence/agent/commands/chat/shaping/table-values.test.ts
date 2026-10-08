import { describe, expect, it } from 'vitest';
import { buildTableArtifact } from '../../../../../contracts/artifacts/table-build.js';
import type { DecisionAnswer, DecisionEngine, DecisionEvaluationResult } from '../../../../../contracts/decision.js';
import { applyJevTableTransform } from './table-transform/index.js';
import { routeChatWithJev } from '../routing/router.js';
import { JEV_CHAT_ROUTE_CRITERIA } from '../routing/route-criteria.js';
const choice = (choice: string): DecisionAnswer => ({ type: 'choice', choice, probabilities: { [choice]: 1 } });
describe('typed categorical filters', () => {
  it.each([['string', '취소'], ['boolean', false]] as const)('filters actual %s values without other columns in the prompt', async (type, value) => {
    const requests: unknown[] = [];
    let count = 0;
    const engine: DecisionEngine = { evaluate: async (request): Promise<DecisionEvaluationResult> => {
      requests.push(request); count++;
      return { answers: count === 1 ? { filter_column: choice('column_1'), filter_operator: choice('neq'), filter_value: choice('none') }
        : { filter_value: choice('value_1') }, providerRequestCount: 2, usage: { inputTokens: 10, outputTokens: 2 } };
    } };
    const table = buildTableArtifact({ id: 'source', headers: ['secret', 'status'], matrix: [['NEVER_COPY', type === 'string' ? '완료' : true], ['NEVER_COPY', value], ['NEVER_COPY', null]] });
    table.source = { table: 'orders' }; table.truncated = true;
    const result = await applyJevTableTransform({ decisionEngine: engine, table, userMessage: '해당 상태 빼줘', mode: 'filter' });
    expect(result.status).toBe('transformed');
    if(result.status !== 'transformed') return;
    expect(result.table.rows.map(r => r.index)).toEqual([0,2]);
    expect(result.table).toMatchObject({ source: { table: 'orders' }, truncated: true });
    expect(result).toMatchObject({ providerRequestCount: 4, usage: { inputTokens: 20, outputTokens: 4 } });
    expect(JSON.stringify(requests)).not.toContain('NEVER_COPY');
  });
  it.each(['mixed', 'unknown', 'too_many', 'too_long'])('stops on %s values before sending value candidates', async kind => {
    const table = buildTableArtifact({ id: 'source', headers: ['status'], matrix: kind === 'too_many' ? Array.from({ length: 65 }, (_, i) => ['status'+i]) : kind === 'too_long' ? [['x'.repeat(257)]] : [['완료'],['취소']] });
    table.columns[0]!.type = kind === 'unknown' ? 'unknown' : 'string';
    if(kind === 'mixed') table.rows[1]!.values.status = false;
    let calls = 0;
    const result = await applyJevTableTransform({ decisionEngine: { evaluate: async () => { calls++; return { answers: { filter_column: choice('column_0'), filter_operator: choice('neq') } }; } }, table, userMessage: '취소 빼줘', mode: 'filter' });
    expect(result.status).toBe('clarify'); expect(calls).toBe(1);
  });
});
it('retains previous_result routing after the first request without a previous table', async () => {
  const seen: boolean[] = [];
  const engine: DecisionEngine = { evaluate: async (request): Promise<DecisionEvaluationResult> => {
    const route = request.questions.route;
    seen.push(route?.type === 'choice' && Object.hasOwn(route.criteria, 'previous_result'));
    return { answers: { route: choice(seen.length === 1 ? 'answer' : 'previous_result'), needs_natural_language_answer: { type: 'boolean', probability: 0 } } };
  } };
  await routeChatWithJev({ decisionEngine: engine, userMessage: '주문좀 보여줘' });
  const result = await routeChatWithJev({ decisionEngine: engine, userMessage: '이거 싼 순으로 뽑아줘', previousReadResult: buildTableArtifact({ id: 'orders', headers: ['price'], matrix: [[2],[1]] }) });
  expect(seen).toEqual([false, true]); expect(result.kind).toBe('previous_result');
  expect(JEV_CHAT_ROUTE_CRITERIA).toHaveProperty('previous_result');
});
