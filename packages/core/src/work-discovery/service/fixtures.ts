import type { CandidateProgram, DiscoverySessionState } from '../schema.js';

export function makeSession(
  id: string,
  overrides: Partial<DiscoverySessionState> = {},
): DiscoverySessionState {
  const now = new Date().toISOString();
  const candidate: CandidateProgram = {
    id: 'candidate_total',
    observationPath: 'field.total',
    expr: { op: 'aggregate', input: { op: 'source', sourceId: 'input:sales' }, fn: 'sum', column: 'amount' },
    score: { total: 1, replay: 1, simplicity: 1 },
    replayResults: [{ exampleId: 'ex_1', expected: 100, actual: 100, match: 1, pass: true }],
    status: 'accepted',
  };
  return {
    id,
    status: 'needs_clarification',
    revision: 3,
    userGoal: '매출 보고 자동화',
    exampleIds: ['ex_1'],
    sourceInventory: [{
      id: 'input:sales',
      connector: 'input_artifact',
      label: 'sales',
      kind: 'workbook',
      relevance: 1,
      metadata: { storedPath: 'sales.xlsx' },
    }],
    observations: [{
      id: 'observation_total',
      exampleId: 'ex_1',
      path: 'field.total',
      label: '총매출',
      value: { kind: 'number', value: 100, display: '100' },
      role: 'dynamic_value',
      required: true,
    }],
    candidates: [candidate],
    pendingQuestion: {
      id: 'question_1',
      sessionId: id,
      kind: 'choose_rule',
      prompt: '어느 규칙이 맞나요?',
      options: [
        { id: 'option_a', label: 'A', candidateIds: ['candidate_total'] },
        { id: 'option_b', label: 'B', candidateIds: ['candidate_other'] },
      ],
      affectedObservationPaths: ['field.total'],
      createdAt: now,
    },
    budgets: { sourceReadsUsed: 0, sourceReadsMax: 12, elapsedMs: 0 },
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}
