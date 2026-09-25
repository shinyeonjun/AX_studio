import { describe, expect, it } from 'vitest';
import type { DecisionEngine } from '../../contracts/decision.js';
import {
  decideDiscoveryRecovery,
  DISCOVERY_RECOVERY_MAX_ATTEMPTS,
  DISCOVERY_RECOVERY_SOURCE_READ_CAP,
} from './decision-controller.js';

const baseInput = {
  userGoal: 'Reproduce the weekly sales report',
  checkpoint: 'validating' as const,
  errorCode: 'no_matching_candidate',
  errorMessage: 'Required output fields could not be replayed.',
  autoRecoveryAttempts: 0,
  budgets: {
    sourceReadsUsed: 12,
    sourceReadsMax: 12,
    elapsedMs: 100,
  },
  sourceInventory: [],
};

describe('decideDiscoveryRecovery', () => {
  it('accepts a decisive bounded source-search expansion', async () => {
    const engine: DecisionEngine = {
      evaluate: async (request) => {
        expect(request.state).toMatchObject({
          userGoal: baseInput.userGoal,
          checkpoint: 'validating',
        });
        return {
          answers: {
            recovery_action: {
              type: 'choice',
              choice: 'expand_source_search',
              probabilities: {
                retry_checkpoint: 0.03,
                expand_source_search: 0.9,
                ask_human: 0.05,
                stop: 0.02,
              },
            },
          },
        };
      },
    };

    const result = await decideDiscoveryRecovery({
      ...baseInput,
      decisionEngine: engine,
    });

    expect(result).toMatchObject({
      action: 'expand_source_search',
      reason: 'decision_engine',
      probability: 0.9,
    });
  });

  it('uses an exact recovery choice even when its probability is low', async () => {
    const engine: DecisionEngine = {
      evaluate: async () => ({
        answers: {
          recovery_action: {
            type: 'choice',
              choice: 'retry_checkpoint',
              probabilities: {
                retry_checkpoint: 0.4,
                expand_source_search: 0.5,
                ask_human: 0.05,
                stop: 0.05,
              },
              confidence: 0.4,
          },
        },
      }),
    };

    const result = await decideDiscoveryRecovery({
      ...baseInput,
      decisionEngine: engine,
    });

    expect(result).toMatchObject({
      action: 'retry_checkpoint',
      probability: 0.4,
      reason: 'decision_engine',
    });
    expect(result.margin).toBeCloseTo(-0.1);
  });

  it('honors Jev selecting human review as the recovery action', async () => {
    const result = await decideDiscoveryRecovery({
      ...baseInput,
      decisionEngine: { evaluate: async () => ({ answers: { recovery_action: {
        type: 'choice', choice: 'ask_human', probabilities: { ask_human: 0.3 }, confidence: 0.3,
      } } }) },
    });
    expect(result).toEqual({ action: 'ask_human', reason: 'unclear' });
  });

  it('asks a human when Jev omits a recovery choice', async () => {
    const result = await decideDiscoveryRecovery({
      ...baseInput,
      decisionEngine: { evaluate: async () => ({ answers: {} }) },
    });
    expect(result).toEqual({ action: 'ask_human', reason: 'invalid_answer' });
  });

  it('preserves the old stop path when the decision engine is unavailable', async () => {
    const engine: DecisionEngine = {
      evaluate: async () => {
        throw new Error('TypeSafe unavailable');
      },
    };

    const result = await decideDiscoveryRecovery({
      ...baseInput,
      decisionEngine: engine,
    });

    expect(result).toEqual({ action: 'stop', reason: 'unavailable' });
  });

  it('refuses more autonomous recovery after the attempt limit', async () => {
    const engine: DecisionEngine = {
      evaluate: async () => {
        throw new Error('should not be called');
      },
    };

    const result = await decideDiscoveryRecovery({
      ...baseInput,
      autoRecoveryAttempts: DISCOVERY_RECOVERY_MAX_ATTEMPTS,
      decisionEngine: engine,
    });

    expect(result).toEqual({ action: 'ask_human', reason: 'attempt_limit' });
  });

  it('refuses to expand source search beyond the hard read cap', async () => {
    const engine: DecisionEngine = {
      evaluate: async () => ({
        answers: {
          recovery_action: {
            type: 'choice',
            choice: 'expand_source_search',
            probabilities: {
              retry_checkpoint: 0.01,
              expand_source_search: 0.95,
              ask_human: 0.03,
              stop: 0.01,
            },
          },
        },
      }),
    };

    const result = await decideDiscoveryRecovery({
      ...baseInput,
      budgets: {
        ...baseInput.budgets,
        sourceReadsMax: DISCOVERY_RECOVERY_SOURCE_READ_CAP,
      },
      decisionEngine: engine,
    });

    expect(result.action).toBe('ask_human');
    expect(result.reason).toBe('budget_cap');
  });
});
