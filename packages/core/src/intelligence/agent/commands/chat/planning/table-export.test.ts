import { expect, it, vi } from 'vitest';
import { buildTableArtifact } from '../../../../../contracts/artifacts/table-build.js';
import type { DecisionEngine, DecisionEvaluationResult } from '../../../../../contracts/decision.js';
import { planPreviousTableExport } from './table-export.js';

const choice = (choice: string) => ({ type: 'choice' as const, choice, probabilities: { [choice]: 1 } });
const table = buildTableArtifact({ id: 'previous', headers: ['id', 'secret'], matrix: [[3, 'host-private-value']] });
it('reviews only metadata, then queues the exact host snapshot and reports evaluator usage', async () => {
  const evaluate = vi.fn<DecisionEngine['evaluate']>(async () => ({ answers: { requirements: choice('met'), scope: choice('preserved') }, providerRequestCount: 2, requestBytes: 123, usage: { inputTokens: 12, outputTokens: 3 } }));
  const plan = await planPreviousTableExport({ table, request: '아까 거 엑셀로 줘', decisionEngine: { evaluate } });
  expect(plan.command?.name).toBe('execution.enqueue_once');
  expect(plan.command?.args.steps).toEqual([{ type: 'action', id: 'export', connector: 'transform', action: 'table_to_xlsx', params: { table } }]);
  expect(JSON.stringify(evaluate.mock.calls)).not.toContain('host-private-value');
  expect(JSON.stringify(evaluate.mock.calls)).not.toContain('secret');
  expect(Object.keys(evaluate.mock.calls[0]![0].questions)).toEqual(['requirements', 'scope']);
  expect(plan).toMatchObject({ evaluationCalls: 1, providerRequestCount: 2, requestBytes: 123, usage: { inputTokens: 12, outputTokens: 3 } });
});
it.each(['missing', 'unclear', 'absent', 'expanded'])('stops without command when final review is %s', async answer => {
  const engine: DecisionEngine = { async evaluate(): Promise<DecisionEvaluationResult> { return { answers: answer === 'absent' ? {} : {
    requirements: choice(answer === 'expanded' ? 'met' : answer), scope: choice(answer === 'expanded' ? 'expanded' : 'preserved'),
  } }; } };
  const plan = await planPreviousTableExport({ table, request: '엑셀', decisionEngine: engine });
  expect(plan.command).toBeUndefined(); expect(plan.message).toContain('확인');
});
it('never evaluates invalid input or an already cancelled request and propagates provider failure', async () => {
  const evaluate = vi.fn<DecisionEngine['evaluate']>(async () => { throw new Error('provider unavailable'); });
  expect((await planPreviousTableExport({ table: {}, request: '엑셀', decisionEngine: { evaluate } })).command).toBeUndefined();
  const controller = new AbortController(); controller.abort();
  await expect(planPreviousTableExport({ table, request: '엑셀', decisionEngine: { evaluate }, signal: controller.signal })).rejects.toThrow();
  expect(evaluate).not.toHaveBeenCalled();
  await expect(planPreviousTableExport({ table, request: '엑셀', decisionEngine: { evaluate } })).rejects.toThrow('provider unavailable');
});
