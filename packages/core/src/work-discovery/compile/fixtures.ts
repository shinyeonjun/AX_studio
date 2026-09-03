import type { CandidateProgram, DiscoverySessionState } from '../schema.js';
export const session: DiscoverySessionState = {
  id: 'disc_compile',
  status: 'ready_to_publish',
  revision: 2,
  userGoal: '월간 매출 보고',
  exampleIds: ['ex_1'],
  sourceInventory: [],
  observations: [{
    id: 'obs_1',
    exampleId: 'ex_1',
    path: 'field.total',
    label: 'total',
    value: { kind: 'number', value: 100, display: '100' },
    role: 'dynamic_value',
    required: true,
  }],
  candidates: [{
    id: 'c1',
    observationPath: 'field.total',
    expr: { op: 'aggregate', input: { op: 'source', sourceId: 'rdb:sales' }, fn: 'sum', column: 'amount' },
    score: { total: 0.95, replay: 1, simplicity: 0.7 },
    replayResults: [{ exampleId: 'ex_1', expected: 100, actual: 100, match: 1, pass: true }],
    status: 'accepted',
  } as CandidateProgram],
  budgets: { sourceReadsUsed: 1, sourceReadsMax: 10, elapsedMs: 5 },
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};
