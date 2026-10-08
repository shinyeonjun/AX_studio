import { describe, expect, it } from 'vitest';
import type {
  DecisionAnswer,
  DecisionEngine,
  DecisionEvaluationResult,
} from '../../../../../contracts/decision.js';
import { clearDynamicCatalogForTests, registerDynamicCapabilities } from '../../../../../catalog/dynamic-catalog.js';
import type { ConnectorCapability } from '../../../../../catalog/capability-types.js';
import { routeChatWithJev } from './jev-router.js';
import { parseParallelToolSelection, selectParallelTools } from './jev-parallel-tool-selection.js';

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
  it('decides the answer requirement and each tool independently in one evaluation', async () => {
    const requests: Parameters<DecisionEngine['evaluate']>[0][] = [];
    const decisionEngine: DecisionEngine = {
      evaluate: async (request): Promise<DecisionEvaluationResult> => {
        requests.push(request);
        return {
          answers: {
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
      needsNaturalLanguageAnswer: false,
      operationDecisions: [
        { id: 'db.read', selected: true },
        { id: 'slack.search', selected: true },
        { id: 'gmail.send', selected: false },
      ],
      telemetry: { evaluationCalls: 1, providerRequestCount: 1, candidateCount: 3, estimatedRequestBytes: 1_234 },
    });
    expect(requests).toHaveLength(1);
    expect(Object.keys(requests[0]!.questions)).toEqual([
      'needs_natural_language_answer', 'tool_0', 'tool_1', 'tool_2',
    ]);
    expect(requests[0]!.questions.tool_0?.type).toBe('boolean');
    expect(requests[0]!.questions.tool_1?.type).toBe('boolean');
  });

  it('allows a natural-language response with no selected tools', async () => {
    const result = await selectParallelTools({
      decisionEngine: {
        evaluate: async () => ({
          answers: {
            needs_natural_language_answer: bool(0.99),
            tool_0: bool(0.01), tool_1: bool(0.01), tool_2: bool(0.01),
          },
        }),
      },
      userMessage: 'Slack 검색 기능이 뭐야?',
      candidates,
    });

    expect(result).toMatchObject({
      kind: 'selected',
      needsNaturalLanguageAnswer: true,
      operationDecisions: [
        { id: 'db.read', selected: false },
        { id: 'slack.search', selected: false },
        { id: 'gmail.send', selected: false },
      ],
    });
  });

  it('fails closed when tool votes are missing, invalid, or neither answer nor tool is selected; leaves out an undecided tool', async () => {
    const selection = (answers: Record<string, DecisionAnswer>) => selectParallelTools({
      decisionEngine: { evaluate: async () => ({ answers }) },
      userMessage: '검색해줘',
      candidates,
    });
    const uncertain = await selection({
      needs_natural_language_answer: bool(0.01),
      tool_0: bool(0.99), tool_1: bool(0.5), tool_2: bool(0.01),
    });
    const incomplete = await selection({
      needs_natural_language_answer: bool(0.01), tool_0: bool(0.99),
    });
    const invalid = await selection({
      needs_natural_language_answer: bool(0.01),
      tool_0: bool(0.99), tool_1: bool(Number.NaN), tool_2: bool(0.01),
    });
    const empty = await selection({
      needs_natural_language_answer: bool(0.01),
      tool_0: bool(0.01), tool_1: bool(0.01), tool_2: bool(0.01),
    });

    // Not choosing an undecided tool only does less; the plan review still checks coverage.
    expect(uncertain).toMatchObject({ kind: 'selected' });
    expect(uncertain.kind === 'selected' && uncertain.operationDecisions.map((decision) => decision.selected)).toEqual([true, false, false]);
    expect(incomplete).toMatchObject({ kind: 'clarify', reason: 'incomplete_tool_answers' });
    expect(invalid).toMatchObject({ kind: 'clarify', reason: 'invalid_tool_answers' });
    expect(empty).toMatchObject({ kind: 'clarify', reason: 'no_answer_or_tool' });
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
            if (request.questions.requirements) return { answers: { requirements: choice('met'), scope: choice('preserved') } };
            if (request.questions.route) {
              return {
                answers: {
                  route: choice('execution_enqueue_once'),
                  needs_natural_language_answer: bool(0.01),
                  tool_0: bool(0.99),
                  tool_1: bool(0.99),
                  ...Object.fromEntries(Object.keys(request.questions)
                    .filter((id) => id.startsWith('tool_') && id !== 'tool_0' && id !== 'tool_1')
                    .map((id) => [id, bool(0.01)])),
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
        telemetry: { evaluationCalls: 3 },
      });
      expect(requests).toHaveLength(3);
      expect(Object.keys(requests[0]!.questions)).toEqual(expect.arrayContaining([
        'needs_natural_language_answer', 'tool_0', 'tool_1',
      ]));
      expect(Object.keys(requests[1]!.questions)).toEqual(['action_input_0', 'action_input_1']);
    } finally {
      clearDynamicCatalogForTests();
    }
  });
});

describe('an undecided "does this need prose" answer', () => {
  const telemetry = { evaluationCalls: 1, providerRequestCount: 1, estimatedRequestBytes: 1, candidateCount: 1 };
  const candidates = [{ id: 'read:slack', kind: 'read' as const, connector: 'slack', capabilityId: 'slack.messages.read', label: '채널 읽기', description: '' }];
  const answers = (prose: number, tool: number) => ({
    needs_natural_language_answer: { type: 'boolean' as const, probability: prose },
    tool_0: { type: 'boolean' as const, probability: tool },
  });

  it('adds prose to a clear read instead of failing it', () => {
    expect(parseParallelToolSelection({ candidates, answers: answers(0.5, 0.9), telemetry }))
      .toMatchObject({ kind: 'selected', needsNaturalLanguageAnswer: true });
  });

  it('still asks when nothing else was chosen', () => {
    expect(parseParallelToolSelection({ candidates, answers: answers(0.5, 0.1), telemetry }))
      .toMatchObject({ kind: 'clarify', reason: 'invalid_answer_requirement' });
  });
});

describe('an undecided answer for one candidate tool', () => {
  const telemetry = { evaluationCalls: 1, providerRequestCount: 1, estimatedRequestBytes: 1, candidateCount: 2 };
  const candidates = [
    { id: 'write:slack', kind: 'write' as const, connector: 'slack', capabilityId: 'slack.message.send', label: 'Slack 메시지', description: '' },
    { id: 'read:gmail', kind: 'read' as const, connector: 'gmail', capabilityId: 'gmail.messages.search', label: 'Gmail 검색', description: '' },
  ];
  it('leaves that tool out instead of failing the request', () => {
    expect(parseParallelToolSelection({
      candidates,
      answers: {
        needs_natural_language_answer: { type: 'boolean', probability: 0.1 },
        tool_0: { type: 'boolean', probability: 0.97 },
        tool_1: { type: 'boolean', probability: 0.5 },
      },
      telemetry,
    })).toMatchObject({ kind: 'selected', operationDecisions: [{ id: 'write:slack', selected: true }, { id: 'read:gmail', selected: false }] });
  });
});
