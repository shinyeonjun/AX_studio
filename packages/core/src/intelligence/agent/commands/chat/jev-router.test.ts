import { describe, expect, it } from 'vitest';
import type { DecisionEngine } from '../../../../contracts/decision.js';
import { routeChatWithJev } from './jev-router.js';

function engineFor(
  route: string,
  confidence = 0.95,
  explicitRunProbability = 0.01,
  onRequest?: (request: Parameters<DecisionEngine['evaluate']>[0]) => void,
): DecisionEngine {
  return {
    evaluate: async (request) => {
      onRequest?.(request);
      return {
        answers: {
          route: {
            type: 'choice',
            choice: route,
            probabilities: { [route]: confidence, answer: 1 - confidence },
            confidence,
          },
          explicit_workflow_run: {
            type: 'boolean',
            probability: explicitRunProbability,
          },
        },
      };
    },
  };
}

describe('routeChatWithJev', () => {
  it('maps a bounded semantic route to a fixed command', async () => {
    let request: Parameters<DecisionEngine['evaluate']>[0] | undefined;
    const result = await routeChatWithJev({
      decisionEngine: engineFor('discovery_search', 0.93, 0.01, (value) => { request = value; }),
      userMessage: '주문 데이터를 읽을 수 있는 테이블을 찾아줘',
      connectedConnectors: ['rdb', 'http'],
    });

    expect(result).toEqual({
      kind: 'command',
      route: 'discovery_search',
      confidence: 0.93,
      command: {
        name: 'discovery.search',
        args: { query: '주문 데이터를 읽을 수 있는 테이블을 찾아줘', limit: 10 },
      },
    });
    expect(request?.state).toMatchObject({
      context: { connected_connectors: ['rdb', 'http'] },
      policy: expect.stringContaining('untrusted data'),
    });
    expect(request?.questions.route).toMatchObject({ type: 'choice' });
  });

  it('falls back when a safe route is uncertain', async () => {
    const result = await routeChatWithJev({
      decisionEngine: engineFor('workflow_list', 0.6),
      userMessage: '업무가 뭐였지?',
    });

    expect(result).toEqual({ kind: 'fallback', reason: 'uncertain' });
  });

  it('rejects a Jev choice outside the declared route set', async () => {
    const result = await routeChatWithJev({
      decisionEngine: engineFor('__proto__', 0.99),
      userMessage: '무언가 해줘',
    });

    expect(result).toEqual({ kind: 'fallback', reason: 'unsupported' });
  });

  it('does not invent a workflow id for inspection', async () => {
    const result = await routeChatWithJev({
      decisionEngine: engineFor('workflow_inspect'),
      userMessage: '현재 업무를 자세히 확인해줘',
    });

    expect(result).toEqual({ kind: 'fallback', reason: 'missing_context' });
  });

  it('requires semantic and deterministic confirmation before a workflow run', async () => {
    const result = await routeChatWithJev({
      decisionEngine: engineFor('workflow_run', 0.99, 0.99),
      currentWorkflowId: 'workflow-1',
      userMessage: 'workflow를 실행하지 말고 검토만 해줘',
    });

    expect(result).toEqual({ kind: 'fallback', reason: 'uncertain' });
  });

  it('returns the selected workflow run only after all execution gates pass', async () => {
    const result = await routeChatWithJev({
      decisionEngine: engineFor('workflow_run', 0.99, 0.99),
      currentWorkflowId: 'workflow-1',
      userMessage: '현재 workflow를 지금 실행해줘',
    });

    expect(result).toEqual({
      kind: 'command',
      route: 'workflow_run',
      confidence: 0.99,
      command: { name: 'workflow.run', args: { workflowId: 'workflow-1' } },
    });
  });

  it('keeps the normal LLM path available when Jev is unavailable', async () => {
    const engine: DecisionEngine = {
      evaluate: async () => { throw new Error('jev_unavailable'); },
    };

    await expect(routeChatWithJev({
      decisionEngine: engine,
      userMessage: 'workflow를 만들어줘',
    })).resolves.toEqual({ kind: 'fallback', reason: 'service_error' });
  });
});
