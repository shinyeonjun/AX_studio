import { describe, expect, it } from 'vitest';
import type { DecisionEngine } from '../../../../contracts/decision.js';
import type { AxCommand, AxCommandDefinition } from '../schema.js';
import { gateChatCommandWithJev } from './jev-command-gate.js';

const definition: Pick<AxCommandDefinition, 'name' | 'lifecycle' | 'mutates'> = {
  name: 'workflow.create',
  lifecycle: 'workflow',
  mutates: true,
};
const command: AxCommand = {
  name: 'workflow.create',
  args: { name: '주간 보고서', goal: '주간 자료를 정리한다' },
};

function engineFor(choice: string, confidence: number, explicit = 0.95): DecisionEngine {
  return {
    evaluate: async () => ({
      answers: {
        intent_match: {
          type: 'choice',
          choice,
          probabilities: {
            allow: choice === 'allow' ? confidence : 0.05,
            clarify: choice === 'clarify' ? confidence : 0.05,
            reject: choice === 'reject' ? confidence : 0.05,
          },
          confidence,
        },
        explicit_action: { type: 'boolean', probability: explicit },
      },
    }),
  };
}

describe('gateChatCommandWithJev', () => {
  it('allows a clearly requested mutation with explicit action evidence', async () => {
    await expect(gateChatCommandWithJev({
      decisionEngine: engineFor('allow', 0.94),
      userMessage: '주간 보고서 workflow를 만들어줘',
      command,
      definition,
    })).resolves.toEqual({ allowed: true, source: 'jev', confidence: 0.94 });
  });

  it('blocks a mutation that is ambiguous or explicitly rejected', async () => {
    await expect(gateChatCommandWithJev({
      decisionEngine: engineFor('reject', 0.95),
      userMessage: 'workflow는 만들지 말고 설명만 해줘',
      command,
      definition,
    })).resolves.toEqual({ allowed: false, reason: 'rejected', confidence: 0.95 });
  });

  it('blocks an allow-shaped answer when confidence or explicit action is insufficient', async () => {
    await expect(gateChatCommandWithJev({
      decisionEngine: engineFor('allow', 0.9, 0.2),
      userMessage: 'workflow 생성이 가능한지 알려줘',
      command,
      definition,
    })).resolves.toEqual({ allowed: false, reason: 'uncertain', confidence: 0.9 });
  });

  it('fails closed when the configured Jev service is unavailable', async () => {
    const decisionEngine: DecisionEngine = {
      evaluate: async () => { throw new Error('jev_unavailable'); },
    };

    await expect(gateChatCommandWithJev({
      decisionEngine,
      userMessage: 'workflow를 만들어줘',
      command,
      definition,
    })).resolves.toEqual({ allowed: false, reason: 'service_unavailable' });
  });
});
