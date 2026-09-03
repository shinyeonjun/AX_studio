import { describe, expect, it } from 'vitest';
import { applyClarificationAnswer } from '../../../../work-discovery/clarification/answer-apply.js';
import { buildClarificationQuestion } from '../../../../work-discovery/clarification/question.js';
import type { CandidateProgram } from '../../../../work-discovery/schema.js';

describe('work discovery correctness regressions', () => {
  it('isolates clarification to affected observation paths', () => {
    const candidate = (id: string, path: string, column: string): CandidateProgram => ({
      id,
      observationPath: path,
      expr: { op: 'aggregate', input: { op: 'source', sourceId: 'input:sales' }, fn: 'sum', column },
      score: { total: 0.95, replay: 1, simplicity: 0.7 },
      replayResults: [{ exampleId: 'ex_1', expected: 1, actual: 1, match: 1, pass: true }],
      status: 'accepted',
    });
    const session = {
      id: 'disc_iso',
      status: 'needs_clarification' as const,
      revision: 1,
      userGoal: '보고',
      exampleIds: ['ex_1'],
      sourceInventory: [],
      observations: [
        { id: 'o1', exampleId: 'ex_1', path: 'field.total_sales', label: '총매출', value: { kind: 'number' as const, value: 100, display: '100' }, role: 'dynamic_value' as const, required: true },
        { id: 'o2', exampleId: 'ex_1', path: 'field.order_count', label: '주문 수', value: { kind: 'number' as const, value: 3, display: '3' }, role: 'dynamic_value' as const, required: true },
      ],
      candidates: [
        candidate('c_sales_a', 'field.total_sales', 'amount'),
        candidate('c_sales_b', 'field.total_sales', 'actual'),
        candidate('c_count', 'field.order_count', 'amount'),
      ],
      budgets: { sourceReadsUsed: 1, sourceReadsMax: 10, elapsedMs: 1 },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const question = buildClarificationQuestion({ sessionId: session.id, candidates: session.candidates })!;
    const answered = applyClarificationAnswer(session, question, question.options[0]!.id);
    const orderCountWinner = answered.candidates.find((entry) => entry.observationPath === 'field.order_count' && entry.status === 'accepted');
    expect(orderCountWinner?.id).toBe('c_count');
  });
});
