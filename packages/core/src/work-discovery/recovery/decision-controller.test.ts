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

  it('falls back to human attention when the decision is not decisive', async () => {
    const engine: DecisionEngine = {
      evaluate: async () => ({
        answers: {
          recovery_action: {
            type: 'choice',
            choice: 'retry_checkpoint',
            probabilities: {
              retry_checkpoint: 0.55,
              expand_source_search: 0.3,
              ask_human: 0.1,
              stop: 0.05,
            },
          },
        },
      }),
    };

    const result = await decideDiscoveryRecovery({
      ...baseInput,
      decisionEngine: engine,
    });

    expect(result.action).toBe('ask_human');
    expect(result.reason).toBe('low_confidence');
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
