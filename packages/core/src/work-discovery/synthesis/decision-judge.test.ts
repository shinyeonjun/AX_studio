import { describe, expect, it } from 'vitest';
import type { DecisionEngine } from '../../contracts/decision.js';
import type { CandidateProgram, SourceDescriptor } from '../schema.js';
import { judgeReplayAmbiguity } from './decision-judge.js';

const outputPath = 'summary.total';

const candidates: CandidateProgram[] = [
  {
    id: 'candidate-a',
    observationPath: outputPath,
    expr: { op: 'source', sourceId: 'source-a' },
    score: { total: 1, replay: 1, simplicity: 1 },
    replayResults: [{
      exampleId: 'example-1',
      expected: 42,
      actual: 42,
      match: 1,
      pass: true,
    }],
    status: 'accepted',
  },
  {
    id: 'candidate-b',
    observationPath: outputPath,
    expr: { op: 'source', sourceId: 'source-b' },
    score: { total: 1, replay: 1, simplicity: 1 },
    replayResults: [{
      exampleId: 'example-1',
      expected: 42,
      actual: 42,
      match: 1,
      pass: true,
    }],
    status: 'accepted',
  },
];

const sources: SourceDescriptor[] = [
  {
    id: 'source-a',
    connector: 'fixture',
    label: 'Orders archive',
    kind: 'table',
    relevance: 1,
  },
  {
    id: 'source-b',
    connector: 'fixture',
    label: 'Current sales table',
    kind: 'table',
    relevance: 1,
  },
];

describe('judgeReplayAmbiguity', () => {
  it('auto-resolves only a high-probability choice with a clear margin', async () => {
    const engine: DecisionEngine = {
      evaluate: async (request) => {
        expect(request.state).toMatchObject({ userGoal: 'Build the current sales summary' });
        expect(request.questions.ambiguity_0?.type).toBe('choice');
        return {
          answers: {
            ambiguity_0: {
              type: 'choice',
              choice: 'candidate_1',
              probabilities: {
                candidate_0: 0.04,
                candidate_1: 0.96,
              },
              confidence: 0.95,
            },
          },
        };
      },
    };

    const result = await judgeReplayAmbiguity({
      decisionEngine: engine,
      userGoal: 'Build the current sales summary',
      candidates,
      ambiguousPaths: [outputPath],
      sourceInventory: sources,
    });

    expect(result.remainingAmbiguousPaths).toEqual([]);
    expect(result.autoResolvedPaths).toEqual([outputPath]);
    expect(result.candidates.map((candidate) => [candidate.id, candidate.status])).toEqual([
      ['candidate-a', 'rejected'],
      ['candidate-b', 'accepted'],
    ]);
  });

  it('keeps the existing clarification path when confidence is not decisive', async () => {
    const engine: DecisionEngine = {
      evaluate: async () => ({
        answers: {
          ambiguity_0: {
            type: 'choice',
            choice: 'candidate_1',
            probabilities: {
              candidate_0: 0.35,
              candidate_1: 0.65,
            },
            confidence: 0.4,
          },
        },
      }),
    };

    const result = await judgeReplayAmbiguity({
      decisionEngine: engine,
      userGoal: 'Build the current sales summary',
      candidates,
      ambiguousPaths: [outputPath],
      sourceInventory: sources,
    });

    expect(result.remainingAmbiguousPaths).toEqual([outputPath]);
    expect(result.autoResolvedPaths).toEqual([]);
    expect(result.candidates.map((candidate) => candidate.status)).toEqual(['accepted', 'accepted']);
  });

  it('fails open to human clarification when the decision engine errors', async () => {
    const engine: DecisionEngine = {
      evaluate: async () => {
        throw new Error('provider unavailable');
      },
    };

    const result = await judgeReplayAmbiguity({
      decisionEngine: engine,
      userGoal: 'Build the current sales summary',
      candidates,
      ambiguousPaths: [outputPath],
      sourceInventory: sources,
    });

    expect(result.remainingAmbiguousPaths).toEqual([outputPath]);
    expect(result.candidates).toEqual(candidates);
  });

  it('bounds remote Jev context and excludes source metadata', async () => {
    let request: Parameters<DecisionEngine['evaluate']>[0] | undefined;
    const engine: DecisionEngine = {
      evaluate: async (next) => {
        request = next;
        return {
          answers: {
            ambiguity_0: {
              type: 'choice',
              choice: 'candidate_1',
              probabilities: { candidate_0: 0.04, candidate_1: 0.96 },
            },
          },
        };
      },
    };
    const untrustedCandidates = candidates.map((candidate, index) => index === 0
      ? {
          ...candidate,
          expr: {
            op: 'column' as const,
            input: candidate.expr,
            name: 'column-' + 'x'.repeat(10_000),
          },
        }
      : candidate);

    await judgeReplayAmbiguity({
      decisionEngine: engine,
      userGoal: '  Build the current sales summary  ',
      candidates: untrustedCandidates,
      ambiguousPaths: [outputPath],
      sourceInventory: [{
        ...sources[0]!,
        profileSummary: 'profile-' + 'x'.repeat(10_000),
        metadata: { storedPath: 'C:\\private\\secret.xlsx' },
      }, sources[1]!],
    });

    expect(request?.state).toMatchObject({
      userGoal: 'Build the current sales summary',
      purpose: 'work_discovery_replay_ambiguity',
    });
    const serialized = JSON.stringify(request);
    expect(serialized).not.toContain('storedPath');
    expect(serialized).not.toContain('C:\\private\\secret.xlsx');
    expect(serialized).not.toContain('x'.repeat(10_000));
    expect(serialized).toContain('untrusted data');
  });

  it('keeps human clarification when a path has too many candidates for Jev', async () => {
    const engine: DecisionEngine = {
      evaluate: async () => {
        throw new Error('Jev should not receive an oversized choice set');
      },
    };
    const tooManyCandidates = Array.from({ length: 33 }, (_, index) => ({
      ...candidates[index % candidates.length]!,
      id: `candidate-${index}`,
    }));

    const result = await judgeReplayAmbiguity({
      decisionEngine: engine,
      userGoal: 'Build the current sales summary',
      candidates: tooManyCandidates,
      ambiguousPaths: [outputPath],
      sourceInventory: sources,
    });

    expect(result.remainingAmbiguousPaths).toEqual([outputPath]);
    expect(result.autoResolvedPaths).toEqual([]);
    expect(result.candidates).toEqual(tooManyCandidates);
  });
});
