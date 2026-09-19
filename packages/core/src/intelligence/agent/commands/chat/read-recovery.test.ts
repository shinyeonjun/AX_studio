import { describe, expect, it } from 'vitest';
import type { DecisionEngine } from '../../../../contracts/decision.js';
import {
  decideReadRecovery,
  isRecoverableReadStatus,
  READ_RECOVERY_MAX_REPAIRS,
} from './read-recovery.js';

const baseInput = {
  userMessage: '주문 상세를 보여줘',
  route: 'parameterized' as const,
  status: 'not_found',
  errorCode: 'order_not_found',
  errorMessage: 'orderId 형식이 올바르지 않습니다.',
  repairAttempts: 0,
};

describe('decideReadRecovery', () => {
  it('allows one evidence-driven repair when Jev is decisive', async () => {
    const engine: DecisionEngine = {
      evaluate: async (request) => {
        expect(request.state).toMatchObject({ purpose: 'read_recovery', route: 'parameterized' });
        return {
          answers: {
            recovery_action: {
              type: 'choice',
              choice: 'repair',
              probabilities: { repair: 0.92, ask_user: 0.05, stop: 0.03 },
            },
          },
        };
      },
    };

    await expect(decideReadRecovery({ ...baseInput, decisionEngine: engine })).resolves.toMatchObject({
      action: 'repair',
      reason: 'decision_engine',
      probability: 0.92,
    });
  });

  it('asks the user when Jev is not decisive or the repair budget is spent', async () => {
    const engine: DecisionEngine = {
      evaluate: async () => ({
        answers: {
          recovery_action: {
            type: 'choice',
            choice: 'repair',
            probabilities: { repair: 0.55, ask_user: 0.35, stop: 0.1 },
          },
        },
      }),
    };

    await expect(decideReadRecovery({ ...baseInput, decisionEngine: engine })).resolves.toMatchObject({
      action: 'ask_user',
      reason: 'low_confidence',
    });
    await expect(decideReadRecovery({
      ...baseInput,
      decisionEngine: engine,
      repairAttempts: READ_RECOVERY_MAX_REPAIRS,
    })).resolves.toEqual({ action: 'ask_user', reason: 'attempt_limit' });
  });

  it('keeps the recovery path restricted to failed read statuses', () => {
    expect(isRecoverableReadStatus('error')).toBe(true);
    expect(isRecoverableReadStatus('not_found')).toBe(true);
    expect(isRecoverableReadStatus('forbidden')).toBe(false);
    expect(isRecoverableReadStatus('error', 'http_401')).toBe(false);
    expect(isRecoverableReadStatus('error', 'rate_limit')).toBe(false);
    expect(isRecoverableReadStatus('ok')).toBe(false);
  });
});
