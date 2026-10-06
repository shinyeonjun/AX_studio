import { describe, expect, it } from 'vitest';
import { buildClarificationQuestion, buildConfirmationQuestion, detectCandidateAmbiguity } from './question.js';
import { applyClarificationAnswer } from './answer-apply.js';
import type { CandidateProgram, DiscoverySessionState } from '../schema.js';

function candidate(id: string, path: string, sourceId: string, fn: 'sum' | 'count' = 'sum'): CandidateProgram {
  return {
    id,
    observationPath: path,
    expr: { op: 'aggregate', input: { op: 'source', sourceId }, fn, column: 'amount' },
    score: { total: 0.9, replay: 0.95, simplicity: 0.7 },
    replayResults: [{ exampleId: 'ex_1', expected: 100, actual: 100, match: 1, pass: true }],
    status: 'accepted',
  };
}

function baseSession(candidates: CandidateProgram[]): DiscoverySessionState {
  return {
    id: 'disc_test',
    status: 'needs_clarification',
    revision: 1,
    userGoal: '월간 보고',
    exampleIds: ['ex_1'],
    sourceInventory: [],
    observations: [{
      id: 'obs_1',
      exampleId: 'ex_1',
      path: 'field.total',
      label: '총매출',
      value: { kind: 'number', value: 100, display: '100' },
      role: 'dynamic_value',
      required: true,
    }],
    candidates,
    budgets: {
      sourceReadsUsed: 1,
      sourceReadsMax: 10,
      elapsedMs: 10,
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

describe('clarification', () => {
  it('detects ambiguity when multiple replay-pass candidates share a path', () => {
    const candidates = [
      candidate('c1', 'field.total', 'rdb:sales'),
      candidate('c2', 'field.total', 'sheet:data.csv', 'count'),
    ];
    expect(detectCandidateAmbiguity(candidates)).toBe(true);
    const question = buildClarificationQuestion({ sessionId: 'disc_test', candidates });
    expect(question?.options.length).toBeGreaterThanOrEqual(2);
  });

  it('applies an answer and narrows to a single accepted candidate', () => {
    const candidates = [
      candidate('c1', 'field.total', 'rdb:sales'),
      candidate('c2', 'field.total', 'sheet:data.csv', 'count'),
    ];
    const session = baseSession(candidates);
    const question = buildClarificationQuestion({ sessionId: session.id, candidates })!;
    const answered = applyClarificationAnswer(session, question, question.options[0]!.id);
    expect(answered.status).toBe('ready_to_publish');
    expect(answered.pendingQuestion).toBeUndefined();
    expect(answered.candidates.filter((entry) => entry.status === 'accepted')).toHaveLength(1);
    expect(answered.blueprint?.publishable).toBe(true);
  });

  it('asks a person to confirm an unambiguous single-example mapping before it becomes publishable', () => {
    const candidates = [candidate('c1', 'field.total', 'rdb:sales')];
    const session = baseSession(candidates);
    const question = buildConfirmationQuestion({ sessionId: session.id, candidates })!;
    expect(question.kind).toBe('confirm_rule');

    const confirmed = applyClarificationAnswer(session, question, 'opt_confirm');
    expect(confirmed.status).toBe('ready_to_publish');
    expect(confirmed.humanConfirmedAt).toEqual(expect.any(String));
    expect(confirmed.blueprint?.publishable).toBe(true);

    const rejected = applyClarificationAnswer(session, question, 'opt_reject');
    expect(rejected.status).toBe('failed');
    expect(rejected.errorCode).toBe('human_rejected_mapping');
    expect(rejected.blueprint).toBeUndefined();
    expect(rejected.candidates.every((entry) => entry.status === 'rejected')).toBe(true);
  });
});
