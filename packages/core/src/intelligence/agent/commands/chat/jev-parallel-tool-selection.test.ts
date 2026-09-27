import { describe, expect, it } from 'vitest';
import type {
  DecisionAnswer,
  DecisionEngine,
  DecisionEvaluationResult,
} from '../../../../contracts/decision.js';
import { clearDynamicCatalogForTests, registerDynamicCapabilities } from '../../../../catalog/dynamic-catalog.js';
import type { ConnectorCapability } from '../../../../catalog/capability-types.js';
import { selectJevActionHints } from './jev-action-catalog.js';
import { routeChatWithJev } from './jev-router.js';
import { selectParallelTools } from './jev-parallel-tool-selection.js';

const candidates = [
  { id: 'db.read', connector: 'rdb', label: 'DB 조회', description: '조건에 맞는 행 조회' },
  { id: 'slack.search', connector: 'slack', label: 'Slack 검색', description: '메시지 검색' },
  { id: 'gmail.send', connector: 'gmail', label: '메일 전송', description: '이메일 전송' },
] as const;

function choice(choice: string): DecisionAnswer {
  return { type: 'choice', choice, probabilities: { [choice]: 0.99 }, confidence: 0.99 };
}

function bool(probability: number): DecisionAnswer {
  return { type: 'boolean', probability };
}

describe('selectParallelTools', () => {
  it('selects multiple tools with mode in one evaluation and never executes them', async () => {
    const requests: Parameters<DecisionEngine['evaluate']>[0][] = [];
    const decisionEngine: DecisionEngine = {
      evaluate: async (request): Promise<DecisionEvaluationResult> => {
        requests.push(request);
        return {
          answers: {
            mode: choice('one_shot'),
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
      mode: 'one_shot',
      selectedToolIds: ['db.read', 'slack.search'],
      telemetry: { evaluationCalls: 1, providerRequestCount: 1, candidateCount: 3, estimatedRequestBytes: 1_234 },
    });
    expect(requests).toHaveLength(1);
    expect(Object.keys(requests[0]!.questions)).toEqual(['mode', 'tool_0', 'tool_1', 'tool_2']);
    expect(requests[0]!.questions.tool_0?.type).toBe('boolean');
    expect(requests[0]!.questions.tool_1?.type).toBe('boolean');
  });

  it('ignores tool votes when the request only needs an answer', async () => {
    const result = await selectParallelTools({
      decisionEngine: {
        evaluate: async () => ({
          answers: { mode: choice('answer'), tool_0: bool(0.99), tool_1: bool(0.99), tool_2: bool(0.99) },
        }),
      },
      userMessage: 'Slack 검색 기능이 뭐야?',
      candidates,
    });

    expect(result).toMatchObject({ kind: 'reply', mode: 'answer', selectedToolIds: [] });
  });

  it('fails closed when any tool vote is uncertain or missing', async () => {
    const uncertain = await selectParallelTools({
      decisionEngine: {
        evaluate: async () => ({
          answers: { mode: choice('one_shot'), tool_0: bool(0.99), tool_1: bool(0.5), tool_2: bool(0.01) },
        }),
      },
      userMessage: '검색해줘',
      candidates,
    });
    const incomplete = await selectParallelTools({
      decisionEngine: {
        evaluate: async () => ({ answers: { mode: choice('one_shot'), tool_0: bool(0.99) } }),
      },
      userMessage: '검색해줘',
      candidates,
    });
    const invalid = await selectParallelTools({
      decisionEngine: {
        evaluate: async () => ({
          answers: { mode: choice('one_shot'), tool_0: bool(0.99), tool_1: bool(Number.NaN), tool_2: bool(0.01) },
        }),
      },
      userMessage: '검색해줘',
      candidates,
    });

    expect(uncertain).toMatchObject({ kind: 'clarify', reason: 'uncertain_tool_answers' });
    expect(incomplete).toMatchObject({ kind: 'clarify', reason: 'incomplete_tool_answers' });
    expect(invalid).toMatchObject({ kind: 'clarify', reason: 'invalid_tool_answers' });
  });

  it('compares a two-tool request against the current sequential workflow planner', async () => {
    clearDynamicCatalogForTests();
    const capabilities: ConnectorCapability[] = [
      {
        id: 'experiment.tool_a', connector: 'experiment', kind: 'write',
        label: 'Tool A', description: 'Independent operation A', sideEffect: 'NONE', params: [],
      },
      {
        id: 'experiment.tool_b', connector: 'experiment', kind: 'write',
        label: 'Tool B', description: 'Independent operation B', sideEffect: 'NONE', params: [],
      },
    ];
    registerDynamicCapabilities(capabilities);
    try {
      let currentCalls = 0;
      const currentResult = await routeChatWithJev({
        decisionEngine: {
          evaluate: async (request): Promise<DecisionEvaluationResult> => {
            currentCalls += 1;
            const questions = request.questions;
            if (questions.route) {
              return {
                answers: {
                  route: choice('execution_enqueue_once'),
                  explicit_execution_now: choice('execute_now'),
                  action_scope: choice('multi_step'),
                },
              };
            }

            const state = request.state as { planned_steps?: unknown[] };
            const plannedCount = state.planned_steps?.length ?? 0;
            const selectedId = plannedCount === 0 ? capabilities[0]!.id : capabilities[1]!.id;
            const stepQuestion = questions.next_step;
            if (stepQuestion?.type !== 'choice') throw new Error('Expected current next-step question.');
            const selectedKey = Object.entries(stepQuestion.criteria).find(([, criterion]) =>
              typeof criterion === 'object' && criterion !== null
                && 'capability_id' in criterion && criterion.capability_id === selectedId,
            )?.[0];
            const selected = plannedCount < capabilities.length ? selectedKey : 'done';
            if (!selected) throw new Error(`Current planner did not offer ${selectedId}.`);
            return { answers: { next_step: choice(selected) } };
          },
        },
        userMessage: 'Tool A와 Tool B를 각각 실행해줘.',
        connectedConnectors: ['experiment'],
      });

      const currentHints = selectJevActionHints(['experiment'], capabilities).hints;
      let parallelCalls = 0;
      const parallelResult = await selectParallelTools({
        decisionEngine: {
          evaluate: async (): Promise<DecisionEvaluationResult> => {
            parallelCalls += 1;
            return {
              answers: {
                mode: choice('one_shot'),
                tool_0: bool(0.99),
                tool_1: bool(0.99),
              },
              requestBytes: 1_000,
              providerRequestCount: 1,
            };
          },
        },
        userMessage: 'Tool A와 Tool B를 각각 실행해줘.',
        candidates: currentHints.map(({ capability }) => ({
          id: capability.id,
          connector: capability.connector,
          label: capability.label,
          description: capability.description,
        })),
      });

      expect(currentResult).toMatchObject({
        kind: 'command',
        command: {
          args: {
            steps: [
              { connector: 'experiment' },
              { connector: 'experiment' },
            ],
          },
        },
      });
      expect(currentCalls).toBe(4);
      expect(parallelResult).toMatchObject({
        kind: 'selected',
        mode: 'one_shot',
        selectedToolIds: capabilities.map(({ id }) => id),
      });
      expect(parallelCalls).toBe(1);
    } finally {
      clearDynamicCatalogForTests();
    }
  });
});
