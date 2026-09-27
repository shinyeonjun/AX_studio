import { describe, expect, it } from 'vitest';
import type {
  DecisionAnswer,
  DecisionEngine,
  DecisionEvaluationResult,
} from '../../../../contracts/decision.js';
import { clearDynamicCatalogForTests, registerDynamicCapabilities } from '../../../../catalog/dynamic-catalog.js';
import type { ConnectorCapability } from '../../../../catalog/capability-types.js';
import { routeChatWithJev } from './jev-router.js';
import { selectParallelTools } from './jev-parallel-tool-selection.js';

const candidates = [
  { id: 'db.read', kind: 'read', connector: 'rdb', label: 'DB 조회', description: '조건에 맞는 행 조회' },
  { id: 'slack.search', kind: 'read', connector: 'slack', label: 'Slack 검색', description: '메시지 검색' },
  { id: 'gmail.send', kind: 'write', connector: 'gmail', label: '메일 전송', description: '이메일 전송' },
] as const;

function choice(choice: string): DecisionAnswer {
  return { type: 'choice', choice, probabilities: { [choice]: 0.99 }, confidence: 0.99 };
}

function bool(probability: number): DecisionAnswer {
  return { type: 'boolean', probability };
}

describe('selectParallelTools', () => {
  it('chooses the action count, answer requirement, and tools in one evaluation', async () => {
    const requests: Parameters<DecisionEngine['evaluate']>[0][] = [];
    const decisionEngine: DecisionEngine = {
      evaluate: async (request): Promise<DecisionEvaluationResult> => {
        requests.push(request);
        return {
          answers: {
            request_mode: choice('multi_action'),
            needs_natural_language_answer: bool(0.01),
            tool_0: bool(0.99),
            tool_1: bool(0.98),
            tool_2: bool(0.01),
          },
          requestBytes: 1_234,
          providerRequestCount: 1,
        };
      },
    };

    const result = await selectParallelTools({
      decisionEngine,
      userMessage: 'DB 조회하고 Slack에서 찾아줘.',
      contextPacket: '이전 요청: 판매 현황을 확인한다.',
      candidates,
    });

    expect(result).toMatchObject({
      kind: 'selected',
      mode: 'multi_action',
      needsNaturalLanguageAnswer: false,
      selectedToolIds: ['db.read', 'slack.search'],
      telemetry: { evaluationCalls: 1, providerRequestCount: 1, candidateCount: 3, estimatedRequestBytes: 1_234 },
    });
    expect(requests).toHaveLength(1);
    expect(Object.keys(requests[0]!.questions)).toEqual([
      'request_mode', 'needs_natural_language_answer', 'tool_0', 'tool_1', 'tool_2',
    ]);
    expect(requests[0]!.questions.tool_0?.type).toBe('boolean');
    expect(requests[0]!.questions.tool_1?.type).toBe('boolean');
  });

  it('returns answer-only only when Jev selects no tools and requests a natural-language answer', async () => {
    const result = await selectParallelTools({
      decisionEngine: {
        evaluate: async () => ({
          answers: {
            request_mode: choice('answer_only'),
            needs_natural_language_answer: bool(0.99),
            tool_0: bool(0.01), tool_1: bool(0.01), tool_2: bool(0.01),
          },
        }),
      },
      userMessage: 'Slack 검색 기능이 뭐야?',
      candidates,
    });

    expect(result).toMatchObject({
      kind: 'reply', mode: 'answer_only', needsNaturalLanguageAnswer: true, selectedToolIds: [],
    });
  });

  it('fails closed when tool votes are uncertain, missing, invalid, or contradict the action count', async () => {
    const selection = (answers: Record<string, DecisionAnswer>) => selectParallelTools({
      decisionEngine: { evaluate: async () => ({ answers }) },
      userMessage: '검색해줘',
      candidates,
    });
    const uncertain = await selection({
      request_mode: choice('multi_action'), needs_natural_language_answer: bool(0.01),
      tool_0: bool(0.99), tool_1: bool(0.5), tool_2: bool(0.01),
    });
    const incomplete = await selection({
      request_mode: choice('multi_action'), needs_natural_language_answer: bool(0.01), tool_0: bool(0.99),
    });
    const invalid = await selection({
      request_mode: choice('single_action'), needs_natural_language_answer: bool(0.01),
      tool_0: bool(0.99), tool_1: bool(Number.NaN), tool_2: bool(0.01),
    });
    const mismatch = await selection({
      request_mode: choice('single_action'), needs_natural_language_answer: bool(0.01),
      tool_0: bool(0.99), tool_1: bool(0.99), tool_2: bool(0.01),
    });

    expect(uncertain).toMatchObject({ kind: 'clarify', reason: 'uncertain_tool_answers' });
    expect(incomplete).toMatchObject({ kind: 'clarify', reason: 'incomplete_tool_answers' });
    expect(invalid).toMatchObject({ kind: 'clarify', reason: 'invalid_tool_answers' });
    expect(mismatch).toMatchObject({ kind: 'clarify', reason: 'tool_count_mismatch' });
  });
});

describe('routeChatWithJev parallel selection', () => {
  it('selects multiple tools in stage one and fills their command blocks in one stage-two evaluation', async () => {
    clearDynamicCatalogForTests();
    const capabilities: ConnectorCapability[] = [
      {
        id: 'experiment.tool_a', connector: 'experiment', kind: 'write',
        label: 'Tool A', description: 'Independent operation A', sideEffect: 'NONE',
        params: [
          { name: 'title', label: 'Title', question: 'Message title', required: false },
          { name: 'body', label: 'Body', question: 'Message body', required: false },
        ],
      },
      {
        id: 'experiment.tool_b', connector: 'experiment', kind: 'write',
        label: 'Tool B', description: 'Independent operation B', sideEffect: 'NONE',
        params: [
          { name: 'title', label: 'Title', question: 'Message title', required: false },
          { name: 'body', label: 'Body', question: 'Message body', required: false },
        ],
      },
    ];
    registerDynamicCapabilities(capabilities);
    const requests: Parameters<DecisionEngine['evaluate']>[0][] = [];
    try {
      const result = await routeChatWithJev({
        decisionEngine: {
          evaluate: async (request): Promise<DecisionEvaluationResult> => {
            requests.push(request);
            if (request.questions.route) {
              return {
                answers: {
                  route: choice('execution_enqueue_once'),
                  request_mode: choice('multi_action'),
                  needs_natural_language_answer: bool(0.01),
                  tool_0: bool(0.99),
                  tool_1: bool(0.99),
                  explicit_execution_now: choice('execute_now'),
                },
              };
            }
            return {
              answers: Object.fromEntries(Object.keys(request.questions).map((id) => [id, choice('field_1')])),
            };
          },
        },
        userMessage: 'Tool A와 Tool B 본문 "완료"로 각각 실행해줘.',
        connectedConnectors: ['experiment'],
      });

      expect(result).toMatchObject({
        kind: 'command',
        command: {
          name: 'execution.enqueue_once',
          args: {
            steps: [
              { id: 'action_1', connector: 'experiment', params: { body: '완료' } },
              { id: 'action_2', connector: 'experiment', params: { body: '완료' } },
            ],
          },
        },
        telemetry: { evaluationCalls: 2 },
      });
      expect(requests).toHaveLength(2);
      expect(Object.keys(requests[0]!.questions)).toEqual(expect.arrayContaining([
        'request_mode', 'needs_natural_language_answer', 'tool_0', 'tool_1',
      ]));
      expect(Object.keys(requests[1]!.questions)).toEqual(['action_input_0', 'action_input_1']);
    } finally {
      clearDynamicCatalogForTests();
    }
  });
});
