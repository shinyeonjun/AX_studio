import { describe, expect, it, vi } from 'vitest';
import {
  MAX_DECISION_CHOICE_CRITERIA,
  type DecisionAnswer,
  type DecisionEngine,
} from '../../../../contracts/decision.js';
import type { WorkspaceSourceRecord } from '../../../../persistence/workspace-source-service.js';
import * as capabilityGraph from '../../../../catalog/capability-graph.js';
import { clearDynamicCatalogForTests, registerDynamicCapabilities } from '../../../../catalog/dynamic-catalog.js';
import type { ConnectorCapability } from '../../../../catalog/capability-types.js';
import { buildJevReadOperationIndex } from '../../../decision/read-operation-catalog.js';
import { JevDecisionEngine } from '../../../decision/jev.js';
import { AxDiscoverySearchArgsSchema } from '../schema/workflow-args.js';
import { jevActionCriteria } from './jev-action-catalog.js';
import { explicitHttpPath } from './jev-http-endpoint.js';
import { routeChatWithJev } from './jev-router.js';
import { deriveJevRequestFeatures } from './request-features.js';

function matchesAction(criterion: unknown, connector: string, action: string): boolean {
  return typeof criterion === 'string' && criterion.startsWith(`${connector}.${action} —`);
}

describe('explicitHttpPath', () => {
  it('separates a Korean object particle attached to a query value', () => {
    expect(explicitHttpPath('GET products?limit=2를 조회하고 표로 보여줘.'))
      .toBe('products?limit=2');
  });
});

describe('jevActionCriteria', () => {
  it('keeps required inputs host-owned during action selection', () => {
    const criteria = jevActionCriteria([
      {
        key: 'send',
        capability: {
          id: 'gmail.message.send', connector: 'gmail', kind: 'write',
          label: 'Send message', description: 'Send one email.', sideEffect: 'EXTERNAL',
          params: [{ name: 'to', label: 'Recipient', question: 'Who receives it?', required: true }],
        },
      },
      {
        key: 'archive',
        capability: {
          id: 'gmail.message.archive', connector: 'gmail', kind: 'write',
          label: 'Archive message', description: 'Archive one email.', sideEffect: 'EXTERNAL', params: [],
        },
      },
    ]);

    expect(criteria.send).toBe('gmail.message.send — Send message: Send one email.');
    expect(String(criteria.send)).not.toContain('Recipient');
    expect(criteria.archive).toBe('gmail.message.archive — Archive message: Archive one email.');
  });
});

function engineFor(
  route: string,
  confidence = 0.95,
  explicitRunChoice: 'run_now' | 'do_not_run' = 'do_not_run',
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
          ...(request.questions.explicit_workflow_run ? {
            explicit_workflow_run: {
              type: 'choice' as const,
              choice: explicitRunChoice,
              probabilities: { [explicitRunChoice]: 0.99 },
              confidence: 0.99,
            },
          } : {}),
          ...(request.questions.table_transform ? {
            table_transform: {
              type: 'choice' as const, choice: 'none',
              probabilities: { none: confidence }, confidence,
            },
          } : {}),
          ...(request.questions.result_limit?.type === 'choice' ? {
            result_limit: {
              type: 'choice' as const,
              choice: Object.keys(request.questions.result_limit.criteria).find((key) => key.startsWith('limit_')) ?? 'none',
              probabilities: { limit_0: confidence },
              confidence,
            },
          } : {}),
        },
      };
    },
  };
}

function pdfSource(index: number): WorkspaceSourceRecord {
  return {
    id: `pdf-${index}`,
    sessionId: 'chat-1',
    artifactId: `artifact-${index}`,
    fileName: `report-${index}.pdf`,
    status: 'ready',
    createdAt: '',
    updatedAt: '',
  };
}

describe('routeChatWithJev', () => {
  it('reuses one available-capability snapshot for write actions and workflow triggers', async () => {
    const availableCapabilities = vi.spyOn(capabilityGraph, 'availableCapabilities');
    let routeContext: Record<string, unknown> | undefined;
    try {
      const result = await routeChatWithJev({
        decisionEngine: engineFor('answer', 0.95, 'do_not_run', (request) => {
          routeContext = (request.state as { context?: Record<string, unknown> }).context;
        }),
        userMessage: '안녕',
        connectedConnectors: ['gmail'],
      });

      expect(result.kind).toBe('reply');
      expect(availableCapabilities).toHaveBeenCalledTimes(1);
      expect(routeContext?.connected_write_action_count).toBeGreaterThan(0);
      expect(routeContext?.workflow_trigger_catalog_size).toBe(1);
    } finally {
      availableCapabilities.mockRestore();
    }
  });

  it('lets Jev select a connected write action from every catalog group', async () => {
    clearDynamicCatalogForTests();
    const capabilities: ConnectorCapability[] = Array.from({ length: 260 }, (_, index) => ({
      id: `test.action_${index}`,
      connector: 'test',
      kind: 'write',
      label: `Action ${index}`,
      description: 'x'.repeat(240),
      sideEffect: 'EXTERNAL',
      params: Array.from({ length: 12 }, (_, paramIndex) => ({
        name: `required_${paramIndex}`,
        label: `Required input ${paramIndex} ${'x'.repeat(80)}`,
        question: 'Required text value',
        required: true,
      })),
    }));
    registerDynamicCapabilities(capabilities);
    const requests: Array<{
      state: unknown;
      questions: Record<string, { type: string; criteria?: Record<string, unknown> }>;
    }> = [];
    const requestBytes: number[] = [];
    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
      const body = String(init?.body);
      requestBytes.push(new TextEncoder().encode(body).byteLength);
      const request = JSON.parse(body) as (typeof requests)[number];
      requests.push(request);
      const answers: Record<string, unknown> = {};
      const choiceForCapability = (
        question: (typeof request.questions)[string],
        capabilityId: string,
      ): string => Object.entries(question.criteria ?? {}).find(([, value]) =>
        typeof value === 'string' && value.startsWith(`${capabilityId} —`),
      )?.[0] ?? 'none';
      const choiceAnswer = (choice: string) => ({
        type: 'choice', choice, probabilities: { [choice]: 0.99 }, confidence: 0.99,
      });

      if (request.questions.route) {
        answers.route = choiceAnswer('execution_enqueue_once');
      }
      if (request.questions.explicit_execution_now) answers.explicit_execution_now = choiceAnswer('execute_now');
      if (request.questions.action_scope) {
        answers.action_scope = { ...choiceAnswer('single_action'), confidence: 0.84 };
      }
      for (const [questionId, question] of Object.entries(request.questions)) {
        if (questionId.startsWith('action_group_') && question.type === 'choice') {
          const first = choiceForCapability(question, 'test.action_0');
          const last = choiceForCapability(question, 'test.action_259');
          answers[questionId] = choiceAnswer(first !== 'none' ? first : last);
        }
        if (questionId.startsWith('action_tournament_') && question.type === 'choice') {
          answers[questionId] = choiceAnswer(choiceForCapability(question, 'test.action_259'));
        }
      }

      return new Response(JSON.stringify({ model: 'jev-latest', answers }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    const decisionEngine = new JevDecisionEngine({ apiKey: 'test-key', fetch: fetchImpl });

    try {
      const result = await routeChatWithJev({
        decisionEngine,
        userMessage: '다음 작업을 지금 실행해줘.',
        connectedConnectors: ['test'],
      });

      expect(requests.length).toBeGreaterThan(1);
      expect(fetchImpl).toHaveBeenCalledTimes(requests.length);
      expect(Object.keys(requests[0]!.questions)).toEqual(['route', 'explicit_execution_now', 'action_scope']);
      expect(JSON.stringify(requests[0])).not.toMatch(/test\.action_\d+/u);
      expect(requests.slice(1).some(({ questions }) => Object.keys(questions).some((id) => id.startsWith('action_group_')))).toBe(true);
      for (const request of requests) {
        for (const question of Object.values(request.questions)) {
          if (question.type === 'choice') {
            expect(Object.keys(question.criteria ?? {}).length).toBeLessThanOrEqual(MAX_DECISION_CHOICE_CRITERIA);
          }
        }
      }
      const actionGroups = requests.flatMap(({ questions }) => Object.entries(questions).filter(
        ([id, question]) => id.startsWith('action_group_') && question.type === 'choice',
      ));
      expect(actionGroups.length).toBeGreaterThan(1);
      expect(actionGroups.every(([, question]) =>
        question.type === 'choice' && Object.keys(question.criteria).length <= MAX_DECISION_CHOICE_CRITERIA,
      )).toBe(true);
      const offeredCapabilityIds = actionGroups.flatMap(([, question]) =>
      question.type === 'choice'
          ? Object.values(question.criteria).flatMap((criterion) =>
              typeof criterion === 'string' && criterion.includes(' — ')
                ? [criterion.split(' — ', 1)[0]!]
                : [],
            )
          : [],
      );
      expect(offeredCapabilityIds).toHaveLength(capabilities.length);
      expect(new Set(offeredCapabilityIds).size).toBe(capabilities.length);
      expect(offeredCapabilityIds).toContain('test.action_0');
      expect(offeredCapabilityIds).toContain('test.action_259');
      const offeredCriteria = actionGroups.flatMap(([, question]) =>
        question.type === 'choice'
          ? Object.entries(question.criteria).filter(([key]) => key !== 'none').map(([, criterion]) => criterion)
          : [],
      );
      expect(offeredCriteria.every((criterion) =>
        typeof criterion === 'string',
      )).toBe(true);
      expect(requests.some(({ questions }) => Object.hasOwn(questions, 'action_tournament_0_group_0'))).toBe(true);
      expect(result.telemetry?.evaluationCalls).toBe(3);
      expect(requestBytes).toHaveLength(4);
      expect(result.telemetry?.providerRequestCount).toBe(requestBytes.length);
      expect(Math.max(...requestBytes)).toBeLessThanOrEqual(65_536);
      expect(result.telemetry?.estimatedRequestBytes).toBe(requestBytes.reduce((total, bytes) => total + bytes, 0));
      expect(result).toMatchObject({
        kind: 'command',
        route: 'execution_enqueue_once',
        command: {
          name: 'execution.enqueue_once',
          args: { steps: [{ connector: 'test', action: 'action_259' }] },
        },
      });
    } finally {
      clearDynamicCatalogForTests();
    }
  });

  it('lets Jev bind a workflow input from every compatible prior output through the chat router', async () => {
    clearDynamicCatalogForTests();
    const source: ConnectorCapability = {
      id: 'rdb.synthetic_source',
      connector: 'rdb',
      kind: 'read',
      label: 'Synthetic source',
      description: 'Test-only source with multiple typed outputs.',
      sideEffect: 'NONE',
      params: [],
      io: { inputs: {}, outputs: { primary: 'TableArtifact', secondary: 'TableArtifact' } },
    };
    const sink: ConnectorCapability = {
      id: 'rdb.synthetic_sink',
      connector: 'rdb',
      kind: 'write',
      label: 'Synthetic sink',
      description: 'Test-only action that consumes a typed table.',
      sideEffect: 'EXTERNAL',
      params: [],
      io: { inputs: { table: 'TableArtifact' }, outputs: {} },
    };
    registerDynamicCapabilities([source, sink]);
    const requests: Parameters<DecisionEngine['evaluate']>[0][] = [];
    try {
    const result = await routeChatWithJev({
      decisionEngine: {
        evaluate: async (request) => {
          requests.push(request);
          const answers: Record<string, DecisionAnswer> = {};
          if (request.questions.route) {
            answers.route = {
              type: 'choice', choice: 'execution_enqueue_once',
              probabilities: { execution_enqueue_once: 0.99 }, confidence: 0.99,
            };
            if (request.questions.explicit_execution_now) {
              answers.explicit_execution_now = { type: 'choice', choice: 'execute_now', probabilities: { execute_now: 0.99 }, confidence: 0.99 };
            }
            if (request.questions.action_scope) {
              answers.action_scope = {
                type: 'choice', choice: 'multi_step',
                probabilities: { multi_step: 0.99 }, confidence: 0.84,
              };
            }
            return { answers };
          }
          if (request.questions.action_scope) {
            return { answers: {
              explicit_execution_now: { type: 'choice', choice: 'execute_now', probabilities: { execute_now: 0.99 }, confidence: 0.99 },
              action_scope: {
                type: 'choice', choice: 'multi_step',
                probabilities: { multi_step: 0.99 }, confidence: 0.99,
              },
            } };
          }

          const state = request.state as { planned_steps?: Array<{ capability_id?: string }> };
          if (request.questions.plan_status) {
            const plannedCount = state.planned_steps?.length ?? 0;
            const targetCapability = plannedCount < 130
              ? source.id
              : plannedCount === 130 ? sink.id : undefined;
            for (const [questionId, question] of Object.entries(request.questions)) {
              if (!questionId.startsWith('next_step_group_') || question.type !== 'choice') continue;
              const choice = targetCapability
                ? Object.entries(question.criteria).find(([, criterion]) =>
                    typeof criterion === 'object' && criterion !== null
                      && 'capability_id' in criterion && criterion.capability_id === targetCapability,
                  )?.[0] ?? 'none'
                : 'none';
              answers[questionId] = {
                type: 'choice', choice, probabilities: { [choice]: 0.99 }, confidence: 0.99,
              };
            }
            const status = plannedCount > 130 ? 'done' : 'continue';
            answers.plan_status = {
              type: 'choice', choice: status, probabilities: { [status]: 0.99 }, confidence: 0.99,
            };
            return { answers };
          }
          if (request.questions.next_step) {
            const plannedCount = state.planned_steps?.length ?? 0;
            const question = request.questions.next_step;
            if (question.type !== 'choice') throw new Error('Expected the workflow next-step choice.');
            const selectedCapability = plannedCount < 130
              ? source.id
              : plannedCount === 130 ? sink.id : undefined;
            const choice = selectedCapability
              ? Object.entries(question.criteria).find(([, criterion]) =>
                  typeof criterion === 'object' && criterion !== null
                    && 'capability_id' in criterion && criterion.capability_id === selectedCapability,
                )?.[0] ?? 'none'
              : 'done';
            answers.next_step = {
              type: 'choice', choice, probabilities: { [choice]: 0.99 }, confidence: 0.99,
            };
            return { answers };
          }

          for (const [questionId, question] of Object.entries(request.questions)) {
            if (!questionId.startsWith('input_') || question.type !== 'choice') continue;
            const keys = Object.keys(question.criteria);
            const choice = questionId.endsWith('_group_0')
              ? keys.find((key) => key.startsWith('source_')) ?? 'none'
              : 'none';
            answers[questionId] = {
              type: 'choice', choice, probabilities: { [choice]: 0.99 }, confidence: 0.99,
            };
          }
          return { answers };
        },
      },
      userMessage: '연결된 데이터 확인 작업을 지금 여러 단계로 실행해줘.',
      connectedConnectors: ['rdb'],
      readOperationHints: [{
        key: 'op_0', capabilityId: source.id, connector: 'rdb',
        label: source.label, description: source.description, params: {},
      }],
    });

    const bindingRequest = requests.find((request) =>
      Object.keys(request.questions).some((id) => id.startsWith('input_')),
    );
    expect(requests.every((request) => !Object.keys(request.questions).some((id) =>
      id === 'action' || id.startsWith('action_group_'),
    ))).toBe(true);
    const bindingGroups = Object.entries(bindingRequest?.questions ?? {})
      .filter(([id, question]) => id.startsWith('input_') && question.type === 'choice');
    const offeredOutputs = bindingGroups.flatMap(([, question]) => question.type === 'choice'
      ? Object.values(question.criteria).flatMap((criterion) =>
          typeof criterion === 'object' && criterion !== null
            && 'from_step' in criterion && 'output' in criterion
            ? [`${String(criterion.from_step)}:${String(criterion.output)}`]
            : [],
        )
      : []);
    expect(bindingGroups).toHaveLength(2);
    expect(offeredOutputs).toHaveLength(260);
    expect(new Set(offeredOutputs).size).toBe(260);
    expect(result.kind).toBe('command');
    if (result.kind === 'command') {
      expect(result.telemetry?.planningCandidateCatalogMayBeBounded).toBe(false);
      expect(result.command.args.steps).toHaveLength(131);
      expect(result.command.args.steps[0]).toMatchObject({
        id: 'jev_step_1', connector: 'rdb', action: 'synthetic_source',
      });
      expect(result.command.args.steps[130]).toMatchObject({
        id: 'jev_step_131', connector: 'rdb', action: 'synthetic_sink',
        bindings: { table: { from: 'jev_step_1', output: 'primary' } },
      });
    }
    } finally {
      clearDynamicCatalogForTests();
    }
  });

  it('routes report source catalogs larger than Jev choice limits through dynamic role classifications', async () => {
    const sourceCount = MAX_DECISION_CHOICE_CRITERIA + 45;
    const requests: Array<{ questions: Record<string, { type: string; criteria?: Record<string, unknown> }> }> = [];
    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
      const request = JSON.parse(String(init?.body)) as (typeof requests)[number];
      requests.push(request);
      const answers: Record<string, unknown> = {};
      for (const [id, question] of Object.entries(request.questions)) {
        if (id === 'route') {
          answers[id] = {
            type: 'choice', choice: 'report_generate',
            probabilities: { report_generate: 0.96 }, confidence: 0.96,
          };
        } else if (id.startsWith('report_source_role_') && question.type === 'choice') {
          const candidateIndex = Number(id.slice('report_source_role_'.length));
          const choice = candidateIndex === sourceCount - 2 ? 'template'
            : candidateIndex === sourceCount - 1 ? 'example' : 'none';
          answers[id] = { type: 'choice', choice, probabilities: { [choice]: 0.96 }, confidence: 0.96 };
        } else if (question.type === 'noul') {
          answers[id] = { type: 'noul', noul: 0.04 };
        } else if (question.type === 'choice') {
          const choice = Object.hasOwn(question.criteria ?? {}, 'none')
            ? 'none' : Object.keys(question.criteria ?? {})[0]!;
          answers[id] = { type: 'choice', choice, probabilities: { [choice]: 0.96 }, confidence: 0.96 };
        } else if (question.type === 'boolean') {
          answers[id] = { type: 'noul', noul: 0.04 };
        }
      }
      return new Response(JSON.stringify({ model: 'jev-latest', answers }), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    });
    const decisionEngine = new JevDecisionEngine({ apiKey: 'test-key', maxRequestBytes: 8_192, fetch: fetchImpl });
    const result = await routeChatWithJev({
      decisionEngine,
      userMessage: '현재 대화의 PDF로 보고서를 만들어줘.',
      hasWorkspaceSession: true,
      resolveWorkspaceSources: () => Array.from({ length: sourceCount }, (_, index) => pdfSource(index)),
    });
    expect(result).toMatchObject({
      kind: 'command',
      route: 'report_generate',
      command: {
        name: 'report.generate',
        args: {
          templateSourceId: `pdf-${sourceCount - 2}`,
          exampleSourceId: `pdf-${sourceCount - 1}`,
        },
      },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(requests.length);
    expect(requests.length).toBeGreaterThan(2);
    const sourceQuestionIds = requests.flatMap(({ questions }) => Object.keys(questions)
      .filter(id => id.startsWith('report_source_role_')));
    expect(sourceQuestionIds).toHaveLength(sourceCount);
    expect(new Set(sourceQuestionIds).size).toBe(sourceCount);
    expect(sourceQuestionIds).toContain(`report_source_role_${sourceCount - 2}`);
    expect(sourceQuestionIds).toContain(`report_source_role_${sourceCount - 1}`);
  });

  it('does not load chat PDF metadata when Jev chooses an answer for report-related wording', async () => {
    let sourceReads = 0;
    let sourceLoads = 0;
    const workspaceSources = new Proxy([] as WorkspaceSourceRecord[], {
      get(target, property, receiver) {
        if (property === 'length') sourceReads += 1;
        return Reflect.get(target, property, receiver) as unknown;
      },
    });
    const result = await routeChatWithJev({
      decisionEngine: engineFor('answer', 0.96),
      userMessage: '보고서를 만드는 방법을 설명해줘.',
      workspaceSources,
      resolveWorkspaceSources: () => {
        sourceLoads += 1;
        return [];
      },
    });

    expect(result).toMatchObject({ kind: 'reply', route: 'answer' });
    expect(sourceReads).toBe(0);
    expect(sourceLoads).toBe(0);
  });

  it('uses Jev’s selected report route and clarifies when no source files are available', async () => {
    let sourceLoads = 0;
    const result = await routeChatWithJev({
      decisionEngine: engineFor('report_generate', 0.6),
      userMessage: '이 자료를 결과 문서로 정리해줘',
      hasWorkspaceSession: true,
      resolveWorkspaceSources: () => {
        sourceLoads += 1;
        return [];
      },
    });

    expect(result).toMatchObject({ kind: 'clarify', route: 'report_generate' });
    expect(sourceLoads).toBe(1);
  });

  it('returns a conversational reply route without selecting a command', async () => {
    await expect(routeChatWithJev({
      decisionEngine: engineFor('answer', 0.96),
      userMessage: 'workflow와 일회 실행의 차이를 설명해줘',
    })).resolves.toEqual({ kind: 'reply', route: 'answer', confidence: 0.96 });
  });

  it('preserves failed provider request counts on route fallback', async () => {
    const failure = Object.assign(new Error('provider unavailable'), { providerRequestCount: 3 });
    const result = await routeChatWithJev({
      decisionEngine: { evaluate: async () => { throw failure; } },
      userMessage: '안녕',
    });

    expect(result).toMatchObject({
      kind: 'fallback',
      reason: 'service_error',
      evaluationCalls: 1,
      providerRequestCount: 3,
    });
  });

  it('does not ask workflow run intent when no saved workflow is available', async () => {
    let questionIds: string[] = [];
    const result = await routeChatWithJev({
      decisionEngine: engineFor('answer', 0.96, 'do_not_run', (request) => {
        questionIds = Object.keys(request.questions);
      }),
      userMessage: 'workflow가 무엇인지 설명해줘',
    });

    expect(result.kind).toBe('reply');
    expect(questionIds).toEqual(['route']);
  });

  it('classifies execution intent without sending connected write candidates until needed', async () => {
    let questionIds: string[] = [];
    const result = await routeChatWithJev({
      decisionEngine: engineFor('answer', 0.96, 'do_not_run', (request) => {
        questionIds = Object.keys(request.questions);
      }),
      userMessage: '이 프로젝트는 다른 자동화 도구와 뭐가 달라?',
      connectedConnectors: ['gmail', 'slack'],
    });

    expect(result).toMatchObject({ kind: 'reply', route: 'answer' });
    expect(questionIds).toContain('route');
    expect(questionIds).toContain('explicit_execution_now');
    expect(questionIds).toContain('action_scope');
    expect(questionIds).not.toContain('action');
  });

  it('lets Jev route an implicit preference to a host-rendered confirmation proposal', async () => {
    let request: Parameters<DecisionEngine['evaluate']>[0] | undefined;
    const result = await routeChatWithJev({
      decisionEngine: {
        evaluate: async (value) => {
          request = value;
          return { answers: {
            route: {
              type: 'choice', choice: 'context_remember',
              probabilities: { context_remember: 0.6, answer: 0.4 }, confidence: 0.6,
            },
          } };
        },
      },
      userMessage: '앞으로 답변은 한국어로 짧게 해줘.',
      hasWorkspaceSession: true,
      sessionMemo: {},
    });

    expect(result).toMatchObject({
      kind: 'command', route: 'context_remember',
      command: {
        name: 'ui.present',
        args: {
          title: '이 내용을 기억할까요?',
          blocks: [{ type: 'note', text: '앞으로 답변은 한국어로 짧게 해줘' }],
          actions: [{
            purpose: 'confirm_context',
            contextUpdate: { scope: 'session', key: 'user_rule_1', value: '앞으로 답변은 한국어로 짧게 해줘' },
          }],
        },
      },
    });
    expect(request?.questions.route?.type).toBe('choice');
    expect(request?.questions.explicit_context_update).toBeUndefined();
    expect(request?.questions.route?.type === 'choice'
      ? request.questions.route.criteria
      : {}).toHaveProperty('context_remember');
  });

  it('does not propose a memory update when Jev chooses a conversational answer', async () => {
    const result = await routeChatWithJev({
      decisionEngine: {
        evaluate: async () => ({
          answers: {
            route: {
              type: 'choice', choice: 'answer',
              probabilities: { answer: 0.96, context_remember: 0.04 }, confidence: 0.96,
            },
          },
        }),
      },
      userMessage: '이걸 저장하지 말고 대화에서만 반영해줘.',
      hasWorkspaceSession: true,
    });

    expect(result).toMatchObject({ kind: 'reply', route: 'answer' });
    expect(result).not.toHaveProperty('command');
  });

  it('rejects a memory route when the host exposes no writable scope', async () => {
    const result = await routeChatWithJev({
      decisionEngine: engineFor('context_remember', 0.98),
      userMessage: '앞으로 답변은 한국어로 해줘.',
    });

    expect(result).toEqual({ kind: 'fallback', reason: 'unsupported' });
  });

  it('does not delegate an uncertain multi-step action to the planner', async () => {
    const result = await routeChatWithJev({
      decisionEngine: {
        evaluate: async () => ({
          answers: {
            route: {
              type: 'choice', choice: 'execution_enqueue_once',
              probabilities: { execution_enqueue_once: 0.96, answer: 0.04 }, confidence: 0.96,
            },
            explicit_execution_now: { type: 'choice', choice: 'execute_now', probabilities: { execute_now: 0.99 }, confidence: 0.99 },
            action_scope: {
              type: 'choice', choice: 'multi_step',
              probabilities: { multi_step: 0.4, single_action: 0.35, unclear: 0.25 }, confidence: 0.4,
            },
          },
        }),
      },
      userMessage: 'Gmail에서 메일을 가져와 요약해서 Slack으로 보내줘',
    });

    expect(result).toMatchObject({ kind: 'clarify', route: 'execution_enqueue_once' });
  });

  it('uses Jev’s selected local action without a second confidence threshold', async () => {
    clearDynamicCatalogForTests();
    registerDynamicCapabilities([{
      id: 'test.archive', connector: 'test', kind: 'write',
      label: 'Archive the test record', description: 'Archive one explicitly selected test record.',
      sideEffect: 'NONE', params: [],
    }]);
    let actionChoice: 'offered' | 'unlisted' = 'offered';
    const decisionEngine: DecisionEngine = {
      evaluate: async (request) => {
        const answers: Record<string, DecisionAnswer> = {};
        for (const [questionId, question] of Object.entries(request.questions)) {
          if (questionId === 'route') {
            answers[questionId] = {
              type: 'choice', choice: 'execution_enqueue_once',
              probabilities: { execution_enqueue_once: 0.99, answer: 0.01 }, confidence: 0.99,
            };
          } else if (questionId === 'explicit_execution_now') {
            answers[questionId] = { type: 'choice', choice: 'execute_now', probabilities: { execute_now: 0.99 }, confidence: 0.99 };
          } else if (questionId === 'action_scope') {
            answers[questionId] = {
              type: 'choice', choice: 'single_action',
              probabilities: { single_action: 0.99, multi_step: 0.01 }, confidence: 0.99,
            };
          } else if (question.type === 'choice' && questionId.startsWith('action')) {
            const offered = Object.entries(question.criteria).find(([, criterion]) =>
              matchesAction(criterion, 'test', 'archive'),
            )?.[0];
            const choice = actionChoice === 'offered' ? offered : 'unlisted.action';
            if (choice) {
              const confidence = actionChoice === 'offered' ? 0.83 : 0.99;
              answers[questionId] = {
                type: 'choice', choice,
                probabilities: { [choice]: actionChoice === 'offered' ? 0.84 : 0.99, none: actionChoice === 'offered' ? 0.16 : 0.01 },
                confidence,
              };
            }
          }
        }
        return { answers };
      },
    };
    const input = {
      decisionEngine,
      connectedConnectors: ['test'],
      userMessage: '테스트 레코드를 지금 보관 처리해줘.',
    };
    try {
      const result = await routeChatWithJev(input);

      expect(result).toMatchObject({
        kind: 'command', route: 'execution_enqueue_once',
        command: { name: 'execution.enqueue_once', args: { steps: [{ connector: 'test', action: 'archive' }] } },
      });

      actionChoice = 'unlisted';
      const unlistedResult = await routeChatWithJev(input);
      expect(unlistedResult).toMatchObject({ kind: 'clarify', route: 'execution_enqueue_once' });
    } finally {
      clearDynamicCatalogForTests();
    }
  });

  it('does not send write tools when Jev has not affirmatively selected execution', async () => {
    clearDynamicCatalogForTests();
    let evaluationCalls = 0;
    registerDynamicCapabilities([{
      id: 'test.archive', connector: 'test', kind: 'write',
      label: 'Archive the test record', description: 'Archive one explicitly selected test record.',
      sideEffect: 'NONE', params: [],
    }]);
    try {
      const result = await routeChatWithJev({
        decisionEngine: {
          evaluate: async (request) => {
            evaluationCalls += 1;
            expect(request.questions).not.toHaveProperty('action');
            return {
              model: 'jev-test',
              providerRequestCount: 1,
              answers: {
                route: {
                  type: 'choice', choice: 'execution_enqueue_once',
                  probabilities: { execution_enqueue_once: 0.43 }, confidence: 0.43,
                },
              },
            };
          },
        },
        userMessage: '테스트 레코드를 지금 보관 처리해줘.',
        connectedConnectors: ['test'],
      });

      expect(result).toMatchObject({ kind: 'clarify', route: 'execution_enqueue_once' });
      expect(result.telemetry).toMatchObject({
        selectedRoute: 'execution_enqueue_once',
        routeConfidence: 0.43,
        actionCandidateCount: 0,
      });
      expect(evaluationCalls).toBe(1);
      expect(result.telemetry).not.toHaveProperty('request');
    } finally {
      clearDynamicCatalogForTests();
    }
  });

  it('fails closed when Jev becomes unavailable after selecting an execution route', async () => {
    clearDynamicCatalogForTests();
    registerDynamicCapabilities([{
      id: 'test.archive', connector: 'test', kind: 'write',
      label: 'Archive the test record', description: 'Archive one explicitly selected test record.',
      sideEffect: 'EXTERNAL', params: [],
    }]);
    const requests: Array<Parameters<DecisionEngine['evaluate']>[0]> = [];
    try {
      const result = await routeChatWithJev({
        decisionEngine: {
          evaluate: async (request) => {
            requests.push(request);
            if (request.questions.route) {
              return {
                model: 'jev-test',
                providerRequestCount: 1,
                answers: {
                  route: {
                    type: 'choice', choice: 'execution_enqueue_once',
                    probabilities: { execution_enqueue_once: 0.96, answer: 0.04 }, confidence: 0.96,
                  },
                  explicit_execution_now: { type: 'choice', choice: 'execute_now', probabilities: { execute_now: 0.99 }, confidence: 0.99 },
                  action_scope: {
                    type: 'choice', choice: 'single_action',
                    probabilities: { single_action: 0.99 }, confidence: 0.99,
                  },
                },
              };
            }
            throw new Error('jev_unavailable');
          },
        },
        userMessage: '테스트 레코드를 지금 보관 처리해줘.',
        connectedConnectors: ['test'],
      });

      expect(requests).toHaveLength(2);
      expect(requests[0]!.questions).toHaveProperty('action_scope');
      expect(requests[1]!.questions).not.toHaveProperty('action_scope');
      expect(Object.keys(requests[1]!.questions).some((id) => id.startsWith('action'))).toBe(true);
      expect(result).toMatchObject({ kind: 'fallback', reason: 'service_error' });
      expect(result.telemetry).toMatchObject({ evaluationCalls: 2, selectedRoute: 'execution_enqueue_once' });
    } finally {
      clearDynamicCatalogForTests();
    }
  });

  it('clarifies when no connected write capability matches instead of inventing an action', async () => {
    let actionChoices: string[] = [];
    const requestQuestionIds: string[][] = [];
    const result = await routeChatWithJev({
      decisionEngine: {
        evaluate: async (request) => {
          requestQuestionIds.push(Object.keys(request.questions));
          const action = request.questions.action;
          actionChoices = action?.type === 'choice' ? Object.keys(action.criteria) : [];
          return {
            answers: {
              route: {
                type: 'choice', choice: 'execution_enqueue_once',
                probabilities: { execution_enqueue_once: 0.96, answer: 0.04 }, confidence: 0.96,
              },
              explicit_execution_now: { type: 'choice', choice: 'execute_now', probabilities: { execute_now: 0.99 }, confidence: 0.99 },
              action_scope: {
                type: 'choice', choice: 'single_action',
                probabilities: { single_action: 0.96, multi_step: 0.02, unclear: 0.02 }, confidence: 0.96,
              },
              action: {
                type: 'choice', choice: 'none',
                probabilities: { none: 0.99, action_0: 0.01 }, confidence: 0.99,
              },
            },
          };
        },
      },
      userMessage: 'Gmail로 메일 보내줘',
      connectedConnectors: ['gmail'],
    });

    const questionIds = requestQuestionIds.flat();
    expect(questionIds).toContain('action_scope');
    expect(questionIds).toContain('action');
    expect(actionChoices).toContain('none');
    expect(actionChoices.some((choice) => choice !== 'none')).toBe(true);
    expect(result).toMatchObject({ kind: 'clarify', route: 'execution_enqueue_once' });
  });

  it('maps a bounded semantic route to a fixed command', async () => {
    let request: Parameters<DecisionEngine['evaluate']>[0] | undefined;
    const result = await routeChatWithJev({
      decisionEngine: engineFor('discovery_search', 0.93, 'do_not_run', (value) => { request = value; }),
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

  it('keeps a long discovery request within the search command schema', async () => {
    const result = await routeChatWithJev({
      decisionEngine: engineFor('discovery_search', 0.93),
      userMessage: '주문 데이터를 찾아줘 '.repeat(60),
      connectedConnectors: ['rdb'],
    });

    expect(result.kind).toBe('command');
    if (result.kind !== 'command' || result.command.name !== 'discovery.search') return;
    expect(result.command.args.query).toHaveLength(500);
    expect(result.command.args.query.endsWith('…[truncated]')).toBe(true);
    expect(AxDiscoverySearchArgsSchema.safeParse(result.command.args).success).toBe(true);
  });

  it('uses the user-requested result count for discovery search', async () => {
    const result = await routeChatWithJev({
      decisionEngine: engineFor('discovery_search', 0.93),
      userMessage: '주문 테이블을 5개 찾아줘',
      connectedConnectors: ['rdb'],
    });

    expect(result).toMatchObject({
      kind: 'command',
      route: 'discovery_search',
      command: {
        name: 'discovery.search',
        args: { query: '주문 테이블을 5개 찾아줘', limit: 5 },
      },
    });
  });

  it('maps an explicit GET path to http.request when one usable endpoint exists', async () => {
    await expect(routeChatWithJev({
      decisionEngine: engineFor('http_read', 0.98),
      userMessage: 'DummyJSON 연결을 사용해서 다음 GET 경로를 호출해줘:\nproducts?limit=10&select=title,price',
      connectedConnectors: ['http'],
      httpEndpoints: [{ id: 'dummyjson', label: 'DummyJSON', usable: true }],
    })).resolves.toEqual({
      kind: 'command',
      route: 'http_read',
      confidence: 0.98,
      tableTransform: 'none',
      command: {
        name: 'capability.invoke',
        args: {
          id: 'http.request',
          params: {
            method: 'GET',
            path: 'products?limit=10&select=title,price',
            connectionId: 'dummyjson',
          },
        },
      },
    });
  });

  it('preserves an explicit HEAD method for the read-only HTTP command', async () => {
    await expect(routeChatWithJev({
      decisionEngine: engineFor('http_read', 0.98),
      userMessage: 'DummyJSON 연결에서 HEAD /health 를 조회해줘.',
      connectedConnectors: ['http'],
      httpEndpoints: [{ id: 'dummyjson', label: 'DummyJSON', usable: true }],
    })).resolves.toMatchObject({
      kind: 'command',
      route: 'http_read',
      command: {
        args: {
          params: { method: 'HEAD', path: '/health', connectionId: 'dummyjson' },
        },
      },
    });
  });

  it('does not turn an explicit write method into a GET read command', async () => {
    await expect(routeChatWithJev({
      decisionEngine: engineFor('http_read', 0.98),
      userMessage: 'POST path: /orders 를 호출해줘.',
      connectedConnectors: ['http'],
      httpEndpoints: [{ id: 'dummyjson', label: 'DummyJSON', usable: true }],
    })).resolves.toEqual({ kind: 'fallback', reason: 'unsupported' });
  });

  it('does not use the only endpoint when an explicit endpoint name does not match', async () => {
    await expect(routeChatWithJev({
      decisionEngine: engineFor('http_read', 0.98),
      userMessage: 'GitHub에서 GET /users 조회해줘.',
      connectedConnectors: ['http'],
      httpEndpoints: [{ id: 'dummyjson', label: 'DummyJSON', usable: true }],
    })).resolves.toEqual({ kind: 'fallback', reason: 'http_endpoint_required' });
  });

  it('distinguishes a missing HTTP path from a missing endpoint choice', async () => {
    await expect(routeChatWithJev({
      decisionEngine: engineFor('http_read', 0.98),
      userMessage: 'DummyJSON에서 상품 목록을 가져와줘.',
      connectedConnectors: ['http'],
      httpEndpoints: [{ id: 'dummyjson', label: 'DummyJSON', usable: true }],
    })).resolves.toEqual({ kind: 'fallback', reason: 'http_path_required' });

    await expect(routeChatWithJev({
      decisionEngine: engineFor('http_read', 0.98),
      userMessage: 'GET /orders 를 조회해줘.',
      connectedConnectors: ['http'],
      httpEndpoints: [
        { id: 'alpha', label: 'Alpha API', usable: true },
        { id: 'beta', label: 'Beta API', usable: true },
      ],
    })).resolves.toEqual({ kind: 'fallback', reason: 'http_endpoint_required' });
  });

  it('routes a natural-language HTTP request through a discovered read catalog', async () => {
    const selection = buildJevReadOperationIndex([{
      connector: 'http',
      connected: true,
      config: { endpoints: [{
        id: 'dummyjson',
        baseUrl: 'https://dummyjson.com/',
        label: 'DummyJSON',
        authType: 'none',
        discoveredReadOperations: [
          { path: 'products', label: 'Products' },
          { path: 'carts', label: 'Carts' },
        ],
      }] },
    }]).select('DummyJSON에서 상품 5개만 가져와서 이름과 가격을 보여줘');
    let selectedOperation: string | undefined;
    const result = await routeChatWithJev({
      decisionEngine: {
        evaluate: async (request) => {
          if (request.questions.read_parameter_0) {
            return { answers: {
              read_parameter_0: { type: 'choice', choice: 'value_0', probabilities: { value_0: 0.99 }, confidence: 0.99 },
            } };
          }
          const question = request.questions.operation;
          if (question?.type !== 'choice') throw new Error('Expected catalog choices');
          selectedOperation = Object.entries(question.criteria).find(([key, value]) =>
            key.startsWith('op_') && JSON.stringify(value).includes('Products'),
          )?.[0];
          const confidence = 0.99;
          return { answers: {
            route: { type: 'choice', choice: 'capability_read', probabilities: { capability_read: confidence }, confidence },
            operation: { type: 'choice', choice: selectedOperation!, probabilities: { [selectedOperation!]: confidence }, confidence },
            table_transform: { type: 'choice', choice: 'none', probabilities: { none: confidence }, confidence },
          } };
        },
      },
      userMessage: 'DummyJSON에서 상품 5개만 가져와서 이름과 가격을 보여줘',
      connectedConnectors: ['http'],
      readOperationHints: selection.hints,
      readOperationCatalogSize: selection.totalCount,
      readOperationSelectionMode: selection.mode,
    });

    expect(selectedOperation).toBeDefined();
    expect(result).toMatchObject({
      kind: 'command',
      route: 'capability_read',
      command: {
        name: 'capability.invoke',
        args: {
          id: 'http.request',
          params: { method: 'GET', path: 'products?limit=5', connectionId: 'dummyjson' },
        },
      },
    });
  });

  it('maps a Jev-selected HTTP endpoint choice back to its host-owned connection ID', async () => {
    let endpointCriteria: Record<string, unknown> | undefined;
    const result = await routeChatWithJev({
      decisionEngine: {
        evaluate: async (request) => {
          const question = request.questions.http_endpoint;
          endpointCriteria = question?.type === 'choice' ? question.criteria : undefined;
          return { answers: {
            route: {
              type: 'choice', choice: 'http_read',
              probabilities: { http_read: 0.98 }, confidence: 0.98,
            },
            http_endpoint: {
              type: 'choice', choice: 'http_endpoint_1',
              probabilities: { http_endpoint_1: 0.97 }, confidence: 0.97,
            },
          } };
        },
      },
      userMessage: 'GET /orders 를 조회해줘.',
      connectedConnectors: ['http'],
      httpEndpoints: [
        { id: 'billing', label: 'Billing API', usable: true },
        { id: 'inventory', label: 'Inventory API', usable: true },
      ],
    });

    expect(endpointCriteria).toMatchObject({
      http_endpoint_0: { label: 'Billing API' },
      http_endpoint_1: { label: 'Inventory API' },
    });
    expect(result).toMatchObject({
      kind: 'command',
      route: 'http_read',
      command: {
        args: { params: { method: 'GET', path: '/orders', connectionId: 'inventory' } },
      },
    });
  });

  it('does not let a Jev endpoint choice override an explicitly unmatched endpoint name', async () => {
    const result = await routeChatWithJev({
      decisionEngine: {
        evaluate: async () => ({ answers: {
          route: {
            type: 'choice', choice: 'http_read',
            probabilities: { http_read: 0.98 }, confidence: 0.98,
          },
          http_endpoint: {
            type: 'choice', choice: 'http_endpoint_0',
            probabilities: { http_endpoint_0: 0.99 }, confidence: 0.99,
          },
        } }),
      },
      userMessage: 'GitHub에서 GET /users 를 조회해줘.',
      connectedConnectors: ['http'],
      httpEndpoints: [
        { id: 'billing', label: 'Billing API', usable: true },
        { id: 'inventory', label: 'Inventory API', usable: true },
      ],
    });

    expect(result).toEqual({ kind: 'fallback', reason: 'http_endpoint_required' });
  });

  it('fails closed for an unlisted HTTP endpoint choice', async () => {
    const choice = 'not-listed';
    const confidence = 0.99;
    const result = await routeChatWithJev({
      decisionEngine: {
        evaluate: async () => ({ answers: {
          route: {
            type: 'choice', choice: 'http_read',
            probabilities: { http_read: 0.98 }, confidence: 0.98,
          },
          http_endpoint: {
            type: 'choice', choice,
            probabilities: { [choice]: confidence }, confidence,
          },
        } }),
      },
      userMessage: 'GET /orders 를 조회해줘.',
      connectedConnectors: ['http'],
      httpEndpoints: [
        { id: 'billing', label: 'Billing API', usable: true },
        { id: 'inventory', label: 'Inventory API', usable: true },
      ],
    });

    expect(result).toEqual({ kind: 'fallback', reason: 'http_endpoint_required' });
  });

  it('uses Jev’s exact HTTP endpoint choice without a confidence cutoff', async () => {
    const result = await routeChatWithJev({
      decisionEngine: {
        evaluate: async () => ({ answers: {
          route: {
            type: 'choice', choice: 'http_read',
            probabilities: { http_read: 0.4, answer: 0.6 }, confidence: 0.4,
          },
          http_endpoint: {
            type: 'choice', choice: 'http_endpoint_0',
            probabilities: { http_endpoint_0: 0.4, none: 0.6 }, confidence: 0.4,
          },
        } }),
      },
      userMessage: 'GET /orders 를 조회해줘.',
      connectedConnectors: ['http'],
      httpEndpoints: [
        { id: 'billing', label: 'Billing API', usable: true },
        { id: 'inventory', label: 'Inventory API', usable: true },
      ],
    });

    expect(result).toMatchObject({
      kind: 'command', route: 'http_read',
      command: { args: { params: { method: 'GET', path: '/orders', connectionId: 'billing' } } },
    });
  });

  it('keeps an exact user-named endpoint ahead of a conflicting Jev choice', async () => {
    const result = await routeChatWithJev({
      decisionEngine: {
        evaluate: async () => ({ answers: {
          route: {
            type: 'choice', choice: 'http_read',
            probabilities: { http_read: 0.98 }, confidence: 0.98,
          },
          http_endpoint: {
            type: 'choice', choice: 'http_endpoint_1',
            probabilities: { http_endpoint_1: 0.99 }, confidence: 0.99,
          },
        } }),
      },
      userMessage: 'Billing API에서 GET /orders 를 조회해줘.',
      connectedConnectors: ['http'],
      httpEndpoints: [
        { id: 'billing', label: 'Billing API', usable: true },
        { id: 'inventory', label: 'Inventory API', usable: true },
      ],
    });

    expect(result).toMatchObject({
      kind: 'command',
      command: { args: { params: { connectionId: 'billing' } } },
    });
  });

  it('maps a Jev-selected catalog operation to a host-owned capability command', async () => {
    let questionIds: string[] = [];
    const result = await routeChatWithJev({
      decisionEngine: {
        evaluate: async (request) => {
          questionIds = Object.keys(request.questions);
          return {
            answers: {
              route: {
                type: 'choice', choice: 'capability_read',
                probabilities: { capability_read: 0.6, answer: 0.4 }, confidence: 0.6,
              },
              operation: {
                type: 'choice', choice: 'op_0',
                probabilities: { op_0: 0.52, none: 0.48 }, confidence: 0.52,
              },
            },
          };
        },
      },
      userMessage: '상품을 10개만 보여줘',
      connectedConnectors: ['openapi'],
      readOperationHints: [{
        key: 'op_0',
        capabilityId: 'openapi.catalog.listProducts',
        connector: 'openapi',
        label: '상품 목록',
        description: 'GET /products — 상품 목록',
        params: { query: { limit: 10 } },
      }],
    });

    expect(questionIds).toContain('operation');
    expect(questionIds).toContain('table_transform');
    expect(result).toEqual({
      kind: 'command',
      route: 'capability_read',
      confidence: 0.6,
      tableTransform: 'uncertain',
      command: {
        name: 'capability.invoke',
        args: {
          id: 'openapi.catalog.listProducts',
          params: { query: { limit: 10 } },
        },
      },
    });
  });

  it('carries Jev-selected table transformation intent with the read command', async () => {
    const result = await routeChatWithJev({
      decisionEngine: {
        evaluate: async () => ({
          answers: {
            route: {
              type: 'choice', choice: 'capability_read',
                probabilities: { capability_read: 0.97, answer: 0.03 }, confidence: 0.97,
            },
            operation: { type: 'choice', choice: 'op_0', probabilities: { op_0: 0.96 }, confidence: 0.96 },
            table_transform: { type: 'choice', choice: 'sort', probabilities: { sort: 0.4 }, confidence: 0.4 },
          },
        }),
      },
      userMessage: '재고가 적은 상품부터 보여줘',
      readOperationHints: [{
        key: 'op_0', capabilityId: 'products.list', connector: 'openapi',
        label: '상품 목록', description: '상품 데이터 조회', params: {},
      }],
    });

    expect(result).toMatchObject({ kind: 'command', route: 'capability_read', tableTransform: 'sort' });
  });

  it('carries a Jev-selected dynamic column projection with the read command', async () => {
    const result = await routeChatWithJev({
      decisionEngine: {
        evaluate: async () => ({ answers: {
          route: {
            type: 'choice', choice: 'capability_read',
            probabilities: { capability_read: 0.97, answer: 0.03 }, confidence: 0.97,
          },
          operation: { type: 'choice', choice: 'op_0', probabilities: { op_0: 0.96 }, confidence: 0.96 },
          table_transform: { type: 'choice', choice: 'none', probabilities: { none: 0.99 }, confidence: 0.99 },
          table_projection: {
            type: 'choice', choice: 'requested_columns',
            probabilities: { requested_columns: 0.4, all_columns: 0.6 }, confidence: 0.4,
          },
        } }),
      },
      userMessage: '고객 번호와 갱신 주기만 보여줘.',
      readOperationHints: [{
        key: 'op_0', capabilityId: 'customers.list', connector: 'openapi',
        label: '고객 조회', description: '고객 데이터 조회', params: {},
      }],
    });

    expect(result).toMatchObject({
      kind: 'command', route: 'capability_read', tableTransform: 'none', tableProjection: 'requested_columns',
    });
  });

  it('preserves Jev selecting no table transform so later code cannot override it', async () => {
    const result = await routeChatWithJev({
      decisionEngine: {
        evaluate: async () => ({ answers: {
          route: {
            type: 'choice', choice: 'capability_read',
            probabilities: { capability_read: 0.97, answer: 0.03 }, confidence: 0.97,
          },
          operation: { type: 'choice', choice: 'op_0', probabilities: { op_0: 0.96 }, confidence: 0.96 },
          table_transform: { type: 'choice', choice: 'none', probabilities: { none: 0.99 }, confidence: 0.99 },
        } }),
      },
      userMessage: '재고가 30 미만인지 확인해서 표로 보여줘.',
      readOperationHints: [{
        key: 'op_0', capabilityId: 'products.list', connector: 'openapi',
        label: '상품 목록', description: '상품 데이터 조회', params: {},
      }],
    });

    expect(result).toMatchObject({ kind: 'command', route: 'capability_read', tableTransform: 'none' });
  });

  it('keeps the host relevance ordering without truncating the indexed read choices', async () => {
    let operationKeys: string[] = [];
    const readOperationHints = Array.from({ length: 65 }, (_, index) => ({
      key: `op_${index}`,
      capabilityId: `rdb.query.table_${index}`,
      connector: 'rdb',
      label: index === 0 ? 'ab' : index === 1 ? 'cde zab' : `table ${index}`,
      description: `read table ${index}`,
      params: { table: `table_${index}` },
    }));
    const result = await routeChatWithJev({
      decisionEngine: {
        evaluate: async (request) => {
          const operation = request.questions.operation;
          operationKeys = operation?.type === 'choice'
            ? Object.keys(operation.criteria).filter((key) => key.startsWith('op_'))
            : [];
          return {
            answers: {
              route: {
                type: 'choice', choice: 'capability_read',
                probabilities: { capability_read: 0.97, answer: 0.03 }, confidence: 0.97,
              },
              operation: {
                type: 'choice', choice: 'op_0',
                probabilities: { op_0: 0.96, none: 0.04 }, confidence: 0.96,
              },
              table_transform: {
                type: 'choice', choice: 'none',
                probabilities: { none: 0.96 }, confidence: 0.96,
              },
            },
          };
        },
      },
      userMessage: 'ab cde 조회해줘',
      connectedConnectors: ['rdb'],
      readOperationHints,
      readOperationCatalogSize: 80,
      readOperationCatalogMayBeBounded: true,
      readOperationSelectionMode: 'lexical_relevance',
    });

    expect(operationKeys.slice(0, 2)).toEqual(['op_0', 'op_1']);
    expect(operationKeys).toHaveLength(65);
    expect(result).toMatchObject({
      kind: 'command',
      command: { args: { id: 'rdb.query.table_0' } },
    });
  });

  it('asks for required values after Jev selects an operation that needs them', async () => {
    await expect(routeChatWithJev({
      decisionEngine: {
        evaluate: async () => ({
          answers: {
            route: {
              type: 'choice', choice: 'capability_read',
              probabilities: { capability_read: 0.97, answer: 0.03 }, confidence: 0.97,
            },
            operation: {
              type: 'choice', choice: 'op_0',
              probabilities: { op_0: 0.96, none: 0.04 }, confidence: 0.96,
            },
          },
        }),
      },
      userMessage: '주문 상세를 보여줘',
      connectedConnectors: ['openapi'],
      readOperationHints: [{
        key: 'op_0',
        capabilityId: 'openapi.orders.getOrder',
        connector: 'openapi',
        label: '주문 상세',
        description: 'GET /orders/{orderId} — 주문 상세',
        params: {},
        parameterHints: [{ path: 'pathParams.orderId', type: 'string', required: true }],
        missingParameterPaths: ['pathParams.orderId'],
      }],
    })).resolves.toEqual({
      kind: 'parameterized',
      route: 'capability_read',
      confidence: 0.97,
      plan: {
        capabilityId: 'openapi.orders.getOrder',
        requiredParameterPaths: ['pathParams.orderId'],
      },
    });
  });

  it('does not expose the catalog route when no read operation metadata exists', async () => {
    let routeCriteria: Record<string, unknown> | undefined;
    const result = await routeChatWithJev({
      decisionEngine: {
        evaluate: async (request) => {
          routeCriteria = (request.questions.route as { criteria: Record<string, unknown> }).criteria;
          return {
            answers: {
              route: {
                type: 'choice', choice: 'answer',
                probabilities: { answer: 0.96 }, confidence: 0.96,
              },
            },
          };
        },
      },
      userMessage: '연결된 API가 뭐야?',
    });

    expect(result).toMatchObject({ kind: 'reply', route: 'answer' });
    expect(routeCriteria).not.toHaveProperty('capability_read');
  });

  it('lets Jev choose between a conceptual answer and connected operations', async () => {
    let questionIds: string[] = [];
    let routeCriteria: Record<string, unknown> | undefined;
    await expect(routeChatWithJev({
      decisionEngine: {
        evaluate: async (request) => {
          questionIds = Object.keys(request.questions);
          routeCriteria = (request.questions.route as { criteria: Record<string, unknown> }).criteria;
          return {
            answers: {
              route: {
                type: 'choice', choice: 'answer', probabilities: { answer: 0.96 }, confidence: 0.96,
              },
            },
          };
        },
      },
      userMessage: 'API가 뭐야?',
      readOperationHints: [{
        key: 'op_0',
        capabilityId: 'openapi.catalog.listProducts',
        connector: 'openapi',
        label: '상품 목록',
        description: 'GET /products — 상품 목록',
        params: {},
      }],
    })).resolves.toMatchObject({ kind: 'reply', route: 'answer' });

    expect(questionIds).toEqual(['route', 'operation', 'table_transform', 'table_projection', 'read_result_style']);
    expect(routeCriteria).toHaveProperty('capability_read');
  });

  it('lets Jev choose when a read result needs natural-language summary generation', async () => {
    const result = await routeChatWithJev({
      decisionEngine: {
        evaluate: async () => ({ answers: {
          route: {
            type: 'choice', choice: 'capability_read',
            probabilities: { capability_read: 0.97, answer: 0.03 }, confidence: 0.97,
          },
          operation: { type: 'choice', choice: 'op_0', probabilities: { op_0: 0.96 }, confidence: 0.96 },
          table_transform: { type: 'choice', choice: 'none', probabilities: { none: 0.99 }, confidence: 0.99 },
          table_projection: { type: 'choice', choice: 'all_columns', probabilities: { all_columns: 0.99 }, confidence: 0.99 },
          read_result_style: {
            type: 'choice', choice: 'summary', probabilities: { summary: 0.97, data: 0.03 }, confidence: 0.97,
          },
        } }),
      },
      userMessage: '이번 달 매출 결과에서 핵심만 요약해줘.',
      readOperationHints: [{
        key: 'op_0', capabilityId: 'sales.list', connector: 'rdb',
        label: '매출 조회', description: '매출 자료를 조회합니다.', params: {},
      }],
    });

    expect(result).toMatchObject({ kind: 'command', route: 'capability_read', readResultStyle: 'summary' });
  });

  it('compiles a read operation Jev selects from an indirect request', async () => {
    let requestFeatures: unknown;
    const result = await routeChatWithJev({
      decisionEngine: {
        evaluate: async (request) => {
          requestFeatures = (request.state as { request_features: unknown }).request_features;
          return {
            answers: {
              route: {
                type: 'choice', choice: 'capability_read',
                probabilities: { capability_read: 0.98, answer: 0.02 }, confidence: 0.98,
              },
              operation: {
                type: 'choice', choice: 'op_0',
                probabilities: { op_0: 0.99, none: 0.01 }, confidence: 0.99,
              },
            },
          };
        },
      },
      userMessage: '이번 달 숫자 흐름이 어떻게 돼?',
      readOperationHints: [{
        key: 'op_0',
        capabilityId: 'rdb.query.read',
        connector: 'rdb',
        label: '월별 매출',
        description: '허용된 테이블 monthly_sales 읽기',
        params: { table: 'monthly_sales', limit: 50 },
      }],
    });

    expect(requestFeatures).toEqual({});
    expect(result).toMatchObject({
      kind: 'command',
      route: 'capability_read',
      command: {
        name: 'capability.invoke',
        args: { id: 'rdb.query.read', params: { table: 'monthly_sales', limit: 50 } },
      },
    });
  });

  it('passes structured request features to Jev for natural-language data requests', async () => {
    let state: Record<string, unknown> | undefined;
    await routeChatWithJev({
      decisionEngine: {
        evaluate: async (request) => {
          state = request.state as Record<string, unknown>;
          return {
            answers: {
              route: {
                type: 'choice', choice: 'answer', probabilities: { answer: 0.96 }, confidence: 0.96,
              },
            },
          };
        },
      },
      userMessage: '상품 5개 부탁해',
      readOperationHints: [{
        key: 'op_0',
        capabilityId: 'openapi.catalog.listProducts',
        connector: 'openapi',
        label: '상품 목록',
        description: 'GET /products — 상품 목록',
        params: {},
      }],
    });

    expect(state).toMatchObject({
      request_features: {
        result_limit_candidates: [5],
      },
    });
  });

  it('routes unmatched bounded catalogs to clarification instead of removing connected-data routing', async () => {
    let routeCriteria: Record<string, unknown> | undefined;
    let operationCriteria: Record<string, unknown> | undefined;
    const result = await routeChatWithJev({
      decisionEngine: {
        evaluate: async (request) => {
          routeCriteria = (request.questions.route as { criteria: Record<string, unknown> }).criteria;
          operationCriteria = (request.questions.operation as { criteria: Record<string, unknown> }).criteria;
          return {
            answers: {
              route: {
                type: 'choice', choice: 'capability_read', probabilities: { capability_read: 0.96 }, confidence: 0.96,
              },
              operation: { type: 'choice', choice: 'none', probabilities: { none: 0.99 }, confidence: 0.99 },
            },
          };
        },
      },
      userMessage: '재고를 보여줘',
      readOperationHints: Array.from({ length: 64 }, (_, index) => ({
        key: `op_${index}`,
        capabilityId: `openapi.orders.operation${index}`,
        connector: 'openapi' as const,
        label: '주문 목록',
        description: 'GET /orders — 주문 목록',
        params: {},
      })),
    });

    expect(result).toEqual(expect.objectContaining({ kind: 'fallback', reason: 'missing_context' }));
    expect(routeCriteria).toHaveProperty('capability_read');
    expect(operationCriteria).toHaveProperty('none');
    expect(Object.keys(operationCriteria ?? {}).filter((key) => key.startsWith('op_'))).toHaveLength(64);
  });

  it('lets Jev select semantically from the full in-limit catalog despite a lexical distractor', async () => {
    const selection = buildJevReadOperationIndex([{
      connector: 'rdb',
      connected: true,
      config: {
        type: 'sqlite',
        allowedTables: [...Array.from({ length: 69 }, (_, index) => `table_${index}`), 'stock', 'inventory'],
      },
    }]).select('stock levels');
    let offeredOperations: string[] = [];
    const result = await routeChatWithJev({
      decisionEngine: {
        evaluate: async (request) => {
          const operation = request.questions.operation;
          offeredOperations = operation?.type === 'choice'
            ? Object.keys(operation.criteria).filter((key) => key.startsWith('op_'))
            : [];
          return { model: 'mock-jev', answers: {
            route: {
              type: 'choice', choice: 'capability_read',
              probabilities: { capability_read: 0.97 }, confidence: 0.97,
            },
            operation: { type: 'choice', choice: 'op_71', probabilities: { op_71: 0.97 }, confidence: 0.97 },
            table_transform: { type: 'choice', choice: 'none', probabilities: { none: 0.97 }, confidence: 0.97 },
          } };
        },
      },
      userMessage: 'stock levels',
      readOperationHints: selection.hints,
      readOperationCatalogSize: selection.totalCount,
      readOperationCatalogMayBeBounded: selection.catalogMayBeBounded,
      readOperationSelectionMode: selection.mode,
    });

    expect(selection.mode).toBe('full_catalog');
    expect(selection.lexicalMatchedOperationCount).toBeGreaterThan(0);
    expect(offeredOperations).toHaveLength(72);
    expect(result).toMatchObject({
      kind: 'command',
      command: { args: { id: 'rdb.query.read', params: { table: 'inventory' } } },
      telemetry: { operationCatalogMayBeBounded: false, operationSelectionMode: 'full_catalog' },
    });
  });

  it('routes a connected local spreadsheet through Jev without exposing its folder path', async () => {
    const selection = buildJevReadOperationIndex([{
      connector: 'local_folder',
      connected: true,
      config: {
        folders: [{ id: 'sales-folder', label: '매출 자료', path: 'C:/private/sales', addedAt: '' }],
      },
    }]).select('sales-2026.xlsx 재고 현황 보여줘');
    let offeredOperation: string | undefined;
    let jevRequest = '';
    const result = await routeChatWithJev({
      decisionEngine: {
        evaluate: async (request) => {
          jevRequest = JSON.stringify(request);
          const operation = request.questions.operation;
          if (operation?.type !== 'choice') throw new Error('Expected operation choices');
          offeredOperation = Object.entries(operation.criteria).find(([key, criterion]) =>
            key.startsWith('op_') && JSON.stringify(criterion).includes('local_sheet'),
          )?.[0];
          const confidence = 0.99;
          return { answers: {
            route: { type: 'choice', choice: 'capability_read', probabilities: { capability_read: confidence }, confidence },
            operation: { type: 'choice', choice: offeredOperation!, probabilities: { [offeredOperation!]: confidence }, confidence },
            table_transform: { type: 'choice', choice: 'none', probabilities: { none: confidence }, confidence },
          } };
        },
      },
      userMessage: 'sales-2026.xlsx 재고 현황 보여줘',
      connectedConnectors: ['local_folder'],
      readOperationHints: selection.hints,
      readOperationCatalogSize: selection.totalCount,
      readOperationSelectionMode: selection.mode,
    });

    expect(offeredOperation).toBeDefined();
    expect(JSON.stringify(selection.hints)).not.toContain('C:/private/sales');
    expect(jevRequest).not.toContain('C:/private/sales');
    expect(result).toMatchObject({
      kind: 'command',
      route: 'capability_read',
      command: { name: 'capability.invoke', args: {
        id: 'local_sheet.read',
        params: { folderId: 'sales-folder', path: 'sales-2026.xlsx' },
      } },
    });
  });

  it('lets Jev bind a schema enum from natural language after selecting an OpenAPI read', async () => {
    const selection = buildJevReadOperationIndex([{
      connector: 'openapi',
      connected: true,
      config: {
        specId: 'orders',
        baseUrl: 'https://api.example.test',
        specJson: {
          openapi: '3.0.0',
          info: { title: 'Orders' },
          servers: [{ url: 'https://api.example.test' }],
          paths: {
            '/orders': {
              get: {
                operationId: 'listOrders',
                summary: '주문 목록',
                parameters: [{
                  name: 'status', in: 'query', required: true,
                  schema: { type: 'string', enum: ['paid', 'pending'] },
                }, {
                  name: 'region', in: 'query', required: false,
                  schema: { type: 'string', enum: ['north', 'south'] },
                }],
              },
            },
          },
        },
      },
    }]).select('paid 주문만 보여줘');
    let evaluations = 0;
    const result = await routeChatWithJev({
      decisionEngine: {
        evaluate: async (request) => {
          evaluations += 1;
          if (request.questions.route) {
            return { answers: {
              route: { type: 'choice', choice: 'capability_read', probabilities: { capability_read: 0.99 }, confidence: 0.99 },
              operation: { type: 'choice', choice: 'op_0', probabilities: { op_0: 0.99 }, confidence: 0.99 },
              table_transform: { type: 'choice', choice: 'none', probabilities: { none: 0.99 }, confidence: 0.99 },
            } };
          }
          const statusQuestion = request.questions.read_parameter_0;
          const regionQuestion = request.questions.read_parameter_1;
          if (statusQuestion?.type !== 'choice' || regionQuestion?.type !== 'choice') {
            throw new Error('Expected batched schema-derived parameter choices');
          }
          expect(Object.keys(statusQuestion.criteria)).toEqual(['none', 'value_0', 'value_1']);
          expect(JSON.stringify(statusQuestion.criteria)).toContain('paid');
          expect(Object.keys(regionQuestion.criteria)).toEqual(['none', 'value_0', 'value_1']);
          return { answers: {
            read_parameter_0: {
              type: 'choice', choice: 'value_0',
              probabilities: { value_0: 0.54, none: 0.46 }, confidence: 0.54,
            },
            read_parameter_1: {
              type: 'choice', choice: 'none',
              probabilities: { none: 0.99 }, confidence: 0.99,
            },
          } };
        },
      },
      userMessage: 'paid 주문만 보여줘',
      connectedConnectors: ['openapi'],
      readOperationHints: selection.hints,
      readOperationCatalogSize: selection.totalCount,
      readOperationSelectionMode: selection.mode,
    });

    expect(evaluations).toBe(2);
    expect(result).toMatchObject({
      kind: 'command',
      route: 'capability_read',
      command: {
        name: 'capability.invoke',
        args: { id: 'openapi.orders.listOrders', params: { query: { status: 'paid' } } },
      },
      telemetry: { evaluationCalls: 2, providerRequestCount: 2 },
    });
  });

  it('keeps a required enum unset when Jev says the request does not specify it', async () => {
    const selection = buildJevReadOperationIndex([{
      connector: 'openapi',
      connected: true,
      config: {
        specId: 'orders',
        baseUrl: 'https://api.example.test',
        specJson: {
          openapi: '3.0.0', info: { title: 'Orders' }, servers: [{ url: 'https://api.example.test' }],
          paths: { '/orders': { get: {
            operationId: 'listOrders',
            parameters: [{ name: 'status', in: 'query', required: true, schema: { type: 'string', enum: ['paid', 'pending'] } }],
          } } },
        },
      },
    }]).select('주문을 보여줘');
    const result = await routeChatWithJev({
      decisionEngine: {
        evaluate: async (request) => request.questions.route
          ? { answers: {
              route: { type: 'choice', choice: 'capability_read', probabilities: { capability_read: 0.99 }, confidence: 0.99 },
              operation: { type: 'choice', choice: 'op_0', probabilities: { op_0: 0.99 }, confidence: 0.99 },
              table_transform: { type: 'choice', choice: 'none', probabilities: { none: 0.99 }, confidence: 0.99 },
            } }
          : { answers: {
              read_parameter_0: { type: 'choice', choice: 'none', probabilities: { none: 0.99 }, confidence: 0.99 },
            } },
      },
      userMessage: '주문을 보여줘',
      connectedConnectors: ['openapi'],
      readOperationHints: selection.hints,
      readOperationCatalogSize: selection.totalCount,
      readOperationSelectionMode: selection.mode,
    });

    expect(result).toMatchObject({
      kind: 'parameterized',
      plan: { capabilityId: 'openapi.orders.listOrders', requiredParameterPaths: ['query.status'] },
    });
  });

  it('defers oversized lexical-miss catalogs for non-reads without dropping read candidates', async () => {
    const hints = Array.from({ length: 510 }, (_, index) => ({
      key: `op_${index}`,
      capabilityId: 'rdb.query.read',
      connector: 'rdb' as const,
      label: `DB 조회 ${index}`,
      description: `허용된 테이블 table-${index} 읽기`,
      params: { table: `table-${index}` },
    }));
    const requests: Parameters<DecisionEngine['evaluate']>[0][] = [];
    const result = await routeChatWithJev({
      decisionEngine: {
        evaluate: async (request) => {
          requests.push(request);
          const answers: Record<string, DecisionAnswer> = {};
          if (request.questions.route) {
            answers.route = {
              type: 'choice', choice: 'capability_read',
              probabilities: { capability_read: 0.97 }, confidence: 0.97,
            };
          } else {
            const operationGroups = Object.entries(request.questions).filter(
              ([questionId, question]) => questionId.startsWith('operation_group_') && question.type === 'choice',
            );
            if (operationGroups.length > 0) {
              for (const [questionId, question] of operationGroups) {
                if (question.type !== 'choice') continue;
                const choice = Object.hasOwn(question.criteria, 'op_508')
                  ? 'op_508'
                  : Object.keys(question.criteria).find((key) => key.startsWith('op_'))!;
                answers[questionId] = {
                  type: 'choice', choice, probabilities: { [choice]: 0.97 }, confidence: 0.97,
                };
              }
            } else {
              const [questionId, question] = Object.entries(request.questions).find(
                ([id, value]) => id.startsWith('operation_tournament_') && value.type === 'choice',
              )!;
              expect(question.type).toBe('choice');
              if (question.type !== 'choice') throw new Error('Expected a Jev tournament choice question.');
              expect(question.criteria).toHaveProperty('op_508');
              answers[questionId] = {
                type: 'choice', choice: 'op_508', probabilities: { op_508: 0.97 }, confidence: 0.97,
              };
            }
          }
          if (request.questions.table_transform) {
            answers.table_transform = {
              type: 'choice', choice: 'none', probabilities: { none: 0.97 }, confidence: 0.97,
            };
          }
          if (request.questions.table_projection) {
            answers.table_projection = {
              type: 'choice', choice: 'all_columns', probabilities: { all_columns: 0.97 }, confidence: 0.97,
            };
          }
          if (request.questions.read_result_style) {
            answers.read_result_style = {
              type: 'choice', choice: 'data', probabilities: { data: 0.97 }, confidence: 0.97,
            };
          }
          return { model: 'mock-jev', providerRequestCount: 1, answers };
        },
      },
      userMessage: '재고 상황을 알려줘',
      readOperationHints: hints,
      readOperationCatalogSize: hints.length,
      readOperationCatalogMayBeBounded: false,
      readOperationSelectionMode: 'no_lexical_match',
    });

    const offeredOperationKeys = Object.entries(requests[1]!.questions)
      .filter(([id, question]) => id.startsWith('operation_group_') && question.type === 'choice')
      .flatMap(([, question]) => question.type === 'choice'
        ? Object.keys(question.criteria).filter((key) => key.startsWith('op_'))
        : []);
    expect(offeredOperationKeys).toEqual(hints.map(({ key }) => key));
    expect(Object.keys(requests[0]!.questions)).not.toContain('operation');
    expect(Object.keys(requests[0]!.questions).some((id) => id.startsWith('operation_group_'))).toBe(false);
    expect(requests[0]!.questions).not.toHaveProperty('table_transform');
    expect(requests[0]!.questions).not.toHaveProperty('table_projection');
    expect(requests[0]!.questions).not.toHaveProperty('read_result_style');
    expect(requests[1]!.questions).toHaveProperty('table_transform');
    expect(requests[1]!.questions).toHaveProperty('table_projection');
    expect(requests[1]!.questions).toHaveProperty('read_result_style');
    expect(requests[0]!.state).toMatchObject({ context: { read_operation_candidates_deferred: true } });
    expect(requests[1]!.state).toMatchObject({ context: { read_operation_candidates_deferred: false } });
    expect(requests).toHaveLength(3);
    expect(result).toMatchObject({
      kind: 'command',
      route: 'capability_read',
      command: { args: { id: 'rdb.query.read', params: { table: 'table-508' } } },
      telemetry: {
        evaluationCalls: 3,
        operationCandidateCount: 510,
        operationCatalogSize: 510,
        operationCatalogMayBeBounded: false,
      },
    });

    const answerQuestionIds: string[][] = [];
    const answer = await routeChatWithJev({
      decisionEngine: engineFor('answer', 0.96, 'do_not_run', (request) => {
        answerQuestionIds.push(Object.keys(request.questions));
      }),
      userMessage: '안녕',
      readOperationHints: hints,
      readOperationCatalogSize: hints.length,
      readOperationCatalogMayBeBounded: false,
      readOperationSelectionMode: 'no_lexical_match',
    });

    expect(answer).toMatchObject({ kind: 'reply', route: 'answer' });
    expect(answerQuestionIds).toHaveLength(1);
    expect(answerQuestionIds[0]).not.toContain('operation');
    expect(answerQuestionIds[0]?.some((id) => id.startsWith('operation_group_'))).toBe(false);
  });

  it('keeps semantically relevant reads available when lexical hits would otherwise hide them', async () => {
    const tables = [...Array.from({ length: 299 }, (_, index) => `archive_${index}`), 'orders'];
    const selection = buildJevReadOperationIndex([{
      connector: 'rdb',
      connected: true,
      config: { type: 'sqlite', allowedTables: ['customer', ...tables] },
    }]).select('customer purchase history');
    const requests: Parameters<DecisionEngine['evaluate']>[0][] = [];
    const result = await routeChatWithJev({
      decisionEngine: {
        evaluate: async (request) => {
          requests.push(request);
          const answers: Record<string, DecisionAnswer> = {
            route: {
              type: 'choice', choice: 'capability_read',
              probabilities: { capability_read: 0.97 }, confidence: 0.97,
            },
            table_transform: {
              type: 'choice', choice: 'none', probabilities: { none: 0.97 }, confidence: 0.97,
            },
          };
          for (const [questionId, question] of Object.entries(request.questions)) {
            if (!questionId.startsWith('operation_group_') || question.type !== 'choice') continue;
            const match = Object.entries(question.criteria).find(([, criterion]) =>
              typeof criterion === 'object' && criterion !== null
                && 'what' in criterion && typeof criterion.what === 'string'
                && criterion.what.includes('orders'),
            )?.[0];
            const choice = match ?? 'none';
            answers[questionId] = {
              type: 'choice', choice, probabilities: { [choice]: 0.97 }, confidence: 0.97,
            };
          }
          return { answers };
        },
      },
      userMessage: 'customer purchase history 조회해줘',
      connectedConnectors: ['rdb'],
      readOperationHints: selection.hints,
      readOperationCatalogSize: selection.totalCount,
      readOperationCatalogMayBeBounded: selection.catalogMayBeBounded,
      readOperationSelectionMode: selection.mode,
    });

    const offeredKeys = Object.entries(requests[0]!.questions)
      .filter(([id, question]) => id.startsWith('operation_group_') && question.type === 'choice')
      .flatMap(([, question]) => question.type === 'choice'
        ? Object.keys(question.criteria).filter((key) => key.startsWith('op_'))
        : []);
    expect(selection.mode).toBe('lexical_relevance');
    expect(selection.catalogMayBeBounded).toBe(false);
    expect(selection.hints).toHaveLength(selection.totalCount);
    expect(offeredKeys).toHaveLength(selection.totalCount);
    expect(new Set(offeredKeys).size).toBe(selection.totalCount);
    expect(result).toMatchObject({
      kind: 'command',
      command: { args: { id: 'rdb.query.read', params: { table: 'orders' } } },
    });
  });

  it('does not send read-result questions when Jev routes oversized-catalog small talk to answer', async () => {
    const hints = Array.from({ length: 260 }, (_, index) => ({
      key: `op_${index}`,
      capabilityId: `rdb.query.read.${index}`,
      connector: 'rdb' as const,
      label: `Synthetic table ${index}`,
      description: `Read rows from synthetic table ${index}.`,
      params: {},
    }));
    const requests: Parameters<DecisionEngine['evaluate']>[0][] = [];
    const result = await routeChatWithJev({
      decisionEngine: {
        evaluate: async (request) => {
          requests.push(request);
          return {
            model: 'mock-jev',
            providerRequestCount: 1,
            answers: {
              route: {
                type: 'choice', choice: 'answer',
                probabilities: { answer: 0.97 }, confidence: 0.97,
              },
            },
          };
        },
      },
      userMessage: '안녕',
      readOperationHints: hints,
      readOperationCatalogSize: hints.length,
      readOperationSelectionMode: 'no_lexical_match',
    });

    expect(result).toMatchObject({ kind: 'reply', route: 'answer' });
    expect(requests).toHaveLength(1);
    expect(Object.keys(requests[0]!.questions)).toEqual(['route']);
    expect(result.telemetry?.questionIds).toEqual(['route']);
  });

  it('treats Jev’s explicit no-match choice as missing context, not an uncertain selection', async () => {
    const result = await routeChatWithJev({
      decisionEngine: {
        evaluate: async () => ({ answers: {
          route: {
            type: 'choice', choice: 'capability_read',
            probabilities: { capability_read: 0.97 }, confidence: 0.97,
          },
          operation: { type: 'choice', choice: 'none', probabilities: { none: 0.97 }, confidence: 0.97 },
        } }),
      },
      userMessage: '이 데이터를 조회해줘',
      readOperationHints: [{
        key: 'op_0', capabilityId: 'rdb.query.read', connector: 'rdb',
        label: 'DB 조회', description: '허용된 테이블 읽기', params: {},
      }],
      readOperationCatalogSize: 1,
      readOperationSelectionMode: 'full_catalog',
    });

    expect(result).toEqual(expect.objectContaining({ kind: 'fallback', reason: 'missing_context' }));
  });

  it('keeps a relevant operation from the bounded catalog available', async () => {
    let operationCriteria: Record<string, unknown> | undefined;
    await routeChatWithJev({
      decisionEngine: {
        evaluate: async (request) => {
          operationCriteria = (request.questions.operation as { criteria: Record<string, unknown> }).criteria;
          return {
            answers: {
              route: {
                type: 'choice', choice: 'answer', probabilities: { answer: 0.96 }, confidence: 0.96,
              },
            },
          };
        },
      },
      userMessage: '재고를 보여줘',
      readOperationHints: [
        ...Array.from({ length: 63 }, (_, index) => ({
          key: `op_${index}`,
          capabilityId: `openapi.orders.operation${index}`,
          connector: 'openapi' as const,
          label: '주문 목록',
          description: 'GET /orders — 주문 목록',
          params: {},
        })),
        {
          key: 'op_63',
          capabilityId: 'openapi.inventory.listStock',
          connector: 'openapi' as const,
          label: '재고 목록',
          description: 'GET /inventory — 재고 목록',
          params: {},
        },
      ],
    });

    expect(operationCriteria).toHaveProperty('op_63');
    expect(Object.keys(operationCriteria ?? {})).toContain('none');
  });

  it('surfaces Jev usage and bounded question metadata for latency accounting', async () => {
    const result = await routeChatWithJev({
      decisionEngine: {
        evaluate: async () => ({
          model: 'jev-1.13',
          usage: { inputTokens: 120, outputTokens: 8 },
          answers: {
            route: {
              type: 'choice', choice: 'answer', probabilities: { answer: 0.96 }, confidence: 0.96,
            },
          },
        }),
      },
      userMessage: '상품 5개 부탁해',
      readOperationCatalogSize: 71,
      readOperationCatalogMayBeBounded: true,
      readOperationSelectionMode: 'lexical_relevance',
      readOperationLexicalMatchedOperationCount: 1,
      readOperationLexicalTopScore: 2,
    });

    expect(result).toMatchObject({
      kind: 'reply',
      telemetry: {
        model: 'jev-1.13',
        inputTokens: 120,
        outputTokens: 8,
        questionIds: ['route', 'result_limit', 'operation'],
        routeCandidateCount: 13,
        operationCandidateCount: 0,
        operationCatalogSize: 71,
        operationCatalogMayBeBounded: true,
        operationSelectionMode: 'lexical_relevance',
        operationLexicalMatchedOperationCount: 1,
        operationLexicalTopScore: 2,
      },
    });
  });

  it('does not guess a connection for an explicit GET when multiple endpoints match none', async () => {
    await expect(routeChatWithJev({
      decisionEngine: engineFor('http_read', 0.98),
      userMessage: 'GET /api/v1/orders?status=paid 를 조회해줘.',
      connectedConnectors: ['http'],
      httpEndpoints: [
        { id: 'alpha', label: 'Alpha API', usable: true },
        { id: 'beta', label: 'Beta API', usable: true },
      ],
    })).resolves.toEqual({ kind: 'fallback', reason: 'http_endpoint_required' });
  });

  it('fails closed for write verbs, absolute URLs, and substring endpoint matches', async () => {
    const endpoints = [
      { id: 'api', label: 'Primary API', usable: true },
      { id: 'billing', label: 'Billing API', usable: true },
    ];
    await expect(routeChatWithJev({
      decisionEngine: engineFor('http_read', 0.98),
      userMessage: 'POST /orders 를 호출해줘.',
      connectedConnectors: ['http'],
      httpEndpoints: endpoints,
    })).resolves.toEqual({ kind: 'fallback', reason: 'unsupported' });
    await expect(routeChatWithJev({
      decisionEngine: engineFor('http_read', 0.98),
      userMessage: 'GET https://example.com/orders 를 조회해줘.',
      connectedConnectors: ['http'],
      httpEndpoints: endpoints,
    })).resolves.toEqual({ kind: 'fallback', reason: 'http_endpoint_required' });
    await expect(routeChatWithJev({
      decisionEngine: engineFor('http_read', 0.98),
      userMessage: 'capitalize labels; GET /orders 를 조회해줘.',
      connectedConnectors: ['http'],
      httpEndpoints: endpoints,
    })).resolves.toEqual({ kind: 'fallback', reason: 'http_endpoint_required' });
  });

  it('accepts Jev’s listed safe route choice regardless of its score', async () => {
    const result = await routeChatWithJev({
      decisionEngine: engineFor('workflow_list', 0.6),
      userMessage: '업무가 뭐였지?',
    });

    expect(result).toEqual({
      kind: 'command',
      route: 'workflow_list',
      confidence: 0.6,
      command: { name: 'workflow.list', args: {} },
    });
  });

  it('rejects a Jev choice outside the declared route set', async () => {
    const result = await routeChatWithJev({
      decisionEngine: engineFor('__proto__', 0.99),
      userMessage: '무언가 해줘',
    });

    expect(result).toEqual({ kind: 'fallback', reason: 'unsupported' });
  });

  it('compiles a report from listed low-score route and source choices', async () => {
    const sources = [
      { id: 'template', sessionId: 'chat-1', artifactId: 'a', fileName: 'blank.pdf', status: 'ready' as const, createdAt: '', updatedAt: '' },
      { id: 'example', sessionId: 'chat-1', artifactId: 'b', fileName: 'completed.pdf', status: 'ready' as const, createdAt: '', updatedAt: '' },
    ];
    let evaluations = 0;
    let sourceLoads = 0;
    const decisionEngine: DecisionEngine = {
      evaluate: async (request) => {
        evaluations += 1;
        if (evaluations === 1) {
          expect(request.questions).not.toHaveProperty('report_template_source');
          expect(request.questions).not.toHaveProperty('report_example_source');
          return {
            model: 'jev',
            usage: { inputTokens: 10, outputTokens: 2 },
            providerRequestCount: 1,
            answers: {
              route: {
                type: 'choice', choice: 'report_generate',
                probabilities: { report_generate: 0.4, answer: 0.6 }, confidence: 0.4,
              },
            },
          };
        }
        expect(request.questions).toHaveProperty('report_source_role_0');
        expect(request.questions).toHaveProperty('report_source_role_1');
        return {
          model: 'jev',
          usage: { inputTokens: 12, outputTokens: 1 },
          providerRequestCount: 1,
          answers: {
            report_source_role_0: {
              type: 'choice', choice: 'template', probabilities: { template: 0.41 }, confidence: 0.41,
            },
            report_source_role_1: {
              type: 'choice', choice: 'example', probabilities: { example: 0.42 }, confidence: 0.42,
            },
          },
        };
      },
    };

    const result = await routeChatWithJev({
      decisionEngine,
      userMessage: '지난달 결과를 빈 양식처럼 정리해줘',
      hasWorkspaceSession: true,
      resolveWorkspaceSources: () => {
        expect(evaluations).toBe(1);
        sourceLoads += 1;
        return sources;
      },
    });

    expect(result).toMatchObject({
      kind: 'command',
      route: 'report_generate',
      command: {
        name: 'report.generate',
        args: {
          goal: '지난달 결과를 빈 양식처럼 정리해줘',
          templateSourceId: 'template',
          exampleSourceId: 'example',
        },
      },
    });
    expect(evaluations).toBe(2);
    expect(sourceLoads).toBe(1);
    expect(result).toMatchObject({
      telemetry: {
        evaluationCalls: 2,
        providerRequestCount: 2,
        inputTokens: 22,
        outputTokens: 3,
        questionIds: expect.arrayContaining([
          'route', 'report_source_role_0', 'report_source_role_1',
        ]),
      },
    });
  });

  it('propagates caller cancellation to a Jev follow-up selection', async () => {
    const controller = new AbortController();
    const sources = [
      { id: 'template', sessionId: 'chat-1', artifactId: 'a', fileName: 'blank.pdf', status: 'ready' as const, createdAt: '', updatedAt: '' },
      { id: 'example', sessionId: 'chat-1', artifactId: 'b', fileName: 'completed.pdf', status: 'ready' as const, createdAt: '', updatedAt: '' },
    ];
    let evaluations = 0;
    let followupSignal: AbortSignal | undefined;
    const decisionEngine: DecisionEngine = {
      evaluate: async (request) => {
        evaluations += 1;
        if (evaluations === 1) {
          return { answers: {
            route: {
              type: 'choice', choice: 'report_generate',
              probabilities: { report_generate: 0.96 }, confidence: 0.96,
            },
          } };
        }
        followupSignal = request.signal;
        return new Promise((_, reject) => {
          request.signal?.addEventListener('abort', () => reject(request.signal?.reason), { once: true });
        });
      },
    };

    const result = routeChatWithJev({
      decisionEngine,
      userMessage: '지난달 결과를 빈 양식처럼 정리해줘',
      hasWorkspaceSession: true,
      resolveWorkspaceSources: () => sources,
      abortSignal: controller.signal,
    });
    for (let attempt = 0; attempt < 8 && evaluations < 2; attempt += 1) await Promise.resolve();
    expect(evaluations).toBe(2);
    expect(followupSignal).toBe(controller.signal);
    controller.abort(new Error('caller cancelled'));
    await expect(result).rejects.toThrow('caller cancelled');
  });

  it('does not ask Jev to choose report sources when fewer than two ready PDFs exist', async () => {
    let sourceLoads = 0;
    const decisionEngine: DecisionEngine = {
      evaluate: async (request) => {
        expect(request.questions).not.toHaveProperty('report_template_source');
        expect(request.questions).not.toHaveProperty('report_example_source');
        return {
          answers: {
            route: {
              type: 'choice', choice: 'workflow_list',
              probabilities: { workflow_list: 0.95, answer: 0.05 }, confidence: 0.95,
            },
            explicit_workflow_run: { type: 'choice', choice: 'do_not_run', probabilities: { do_not_run: 0.99 }, confidence: 0.99 },
          },
        };
      },
    };

    await expect(routeChatWithJev({
      decisionEngine,
      userMessage: '저장된 업무를 보여줘',
      workspaceSources: [{
        id: 'only-pdf', sessionId: 'chat-1', artifactId: 'a', fileName: 'only.pdf',
        status: 'ready', createdAt: '', updatedAt: '',
      }],
      resolveWorkspaceSources: () => {
        sourceLoads += 1;
        return [];
      },
    })).resolves.toMatchObject({
      kind: 'command',
      route: 'workflow_list',
      command: { name: 'workflow.list', args: {} },
    });
    expect(sourceLoads).toBe(0);
  });

  it('asks for missing report sources only after Jev selects report generation', async () => {
    let evaluations = 0;
    let sourceLoads = 0;
    const result = await routeChatWithJev({
      decisionEngine: {
        evaluate: async (request) => {
          evaluations += 1;
          expect(request.questions).not.toHaveProperty('report_template_source');
          expect(request.questions).not.toHaveProperty('report_example_source');
          return {
            answers: {
              route: {
                type: 'choice', choice: 'report_generate',
                probabilities: { report_generate: 0.96 }, confidence: 0.96,
              },
            },
          };
        },
      },
      userMessage: '결과물을 기존 자료 형식에 맞춰 만들어줘',
      hasWorkspaceSession: true,
      resolveWorkspaceSources: () => {
        sourceLoads += 1;
        return [];
      },
    });

    expect(result).toMatchObject({ kind: 'clarify', route: 'report_generate' });
    expect(evaluations).toBe(1);
    expect(sourceLoads).toBe(1);
  });

  it('rejects a workflow inspection choice when no current workflow is available', async () => {
    const result = await routeChatWithJev({
      decisionEngine: engineFor('workflow_inspect'),
      userMessage: '현재 업무를 자세히 확인해줘',
    });

    expect(result).toEqual({ kind: 'fallback', reason: 'unsupported' });
  });

  it('lets Jev and the host compile an explicitly requested manual workflow', async () => {
    const decisionStates: unknown[] = [];
    const result = await routeChatWithJev({
      decisionEngine: {
        evaluate: async (request) => {
          decisionStates.push(request.state);
          if (request.questions.route) {
            return {
              answers: {
                route: {
                  type: 'choice', choice: 'workflow_create',
                  probabilities: { workflow_create: 0.4, answer: 0.6 }, confidence: 0.4,
                },
                explicit_workflow_create: { type: 'choice', choice: 'create_now', probabilities: { create_now: 0.54, unclear: 0.46 }, confidence: 0.54 },
                workflow_trigger: {
                  type: 'choice', choice: 'manual',
                  probabilities: { manual: 0.54, schedule: 0.46 }, confidence: 0.54,
                },
              },
              providerRequestCount: 2,
            };
          }
          const next = request.questions.next_step;
          if (next?.type !== 'choice') throw new Error('expected workflow planning');
          const state = request.state as { planned_steps?: unknown[] };
          if ((state.planned_steps?.length ?? 0) > 0) {
            return {
              answers: {
                next_step: { type: 'choice', choice: 'done', probabilities: { done: 0.99 }, confidence: 0.99 },
              },
              providerRequestCount: 4,
            };
          }
          const selected = Object.entries(next.criteria).find(([, criterion]) =>
            JSON.stringify(criterion).includes('gmail.messages.search'));
          return {
            answers: {
              next_step: {
                type: 'choice', choice: selected?.[0] ?? 'done',
                probabilities: { [selected?.[0] ?? 'done']: 0.99, done: selected ? 0.01 : 0.99 },
                confidence: 0.99,
              },
            },
            providerRequestCount: 3,
          };
        },
      },
      userMessage: '매일은 아니고 이번에 한 번 쓸 Gmail 수동 workflow를 저장해줘',
      connectedConnectors: ['gmail'],
      hasWorkspaceSession: true,
      sessionMemo: { tone: '간결하게' },
      workflowPolicy: { confidentiality: '고객 정보 보호' },
      readOperationHints: [{
        key: 'gmail_search', capabilityId: 'gmail.messages.search', connector: 'gmail',
        label: 'Gmail 메일 검색', description: 'Gmail 메일 목록 조회', params: {},
      }],
    });

    expect(result).toMatchObject({
      kind: 'command', route: 'workflow_create', confidence: 0.4,
      command: {
        name: 'workflow.create',
        args: {
          trigger: { type: 'manual' },
          steps: [{ connector: 'gmail', action: 'messages.search' }],
        },
      },
    });
    expect(result.telemetry).toMatchObject({
      evaluationCalls: 3,
      providerRequestCount: 9,
      planningCalls: 2,
      planningProviderRequestCount: 7,
    });
    expect(decisionStates[0]).toMatchObject({
      context: {
        user_confirmed_preferences: {
          values: [
            { scope: 'session', key: 'tone', value: '간결하게' },
            { scope: 'workflow', key: 'confidentiality', value: '고객 정보 보호' },
          ],
        },
      },
    });
    expect(decisionStates[1]).toMatchObject({
      user_confirmed_preferences: {
        values: [
          { scope: 'session', key: 'tone', value: '간결하게' },
          { scope: 'workflow', key: 'confidentiality', value: '고객 정보 보호' },
        ],
      },
    });
  });

  it('keeps failed workflow-planning provider requests in chat telemetry', async () => {
    const failure = Object.assign(new Error('provider unavailable'), { providerRequestCount: 3, requestBytes: 987 });
    let routeEvaluated = false;
    const result = await routeChatWithJev({
      decisionEngine: {
        evaluate: async (request) => {
          if (request.questions.route) {
            routeEvaluated = true;
            return {
              answers: {
                route: {
                  type: 'choice', choice: 'workflow_create',
                  probabilities: { workflow_create: 0.95, answer: 0.05 }, confidence: 0.95,
                },
                explicit_workflow_create: { type: 'choice', choice: 'create_now', probabilities: { create_now: 0.99 }, confidence: 0.99 },
                workflow_trigger: {
                  type: 'choice', choice: 'manual',
                  probabilities: { manual: 0.99, schedule: 0.01 }, confidence: 0.99,
                },
              },
              providerRequestCount: 2,
            };
          }
          if (!routeEvaluated) throw new Error('expected route evaluation first');
          throw failure;
        },
      },
      userMessage: 'Gmail에서 메일을 찾는 수동 workflow를 저장해줘',
      connectedConnectors: ['gmail'],
      hasWorkspaceSession: true,
      readOperationHints: [{
        key: 'gmail_search', capabilityId: 'gmail.messages.search', connector: 'gmail',
        label: 'Gmail 메일 검색', description: 'Gmail 메일 목록 조회', params: {},
      }],
    });

    expect(result).toMatchObject({ kind: 'clarify', route: 'workflow_create' });
    expect(result.telemetry).toMatchObject({
      evaluationCalls: 2,
      providerRequestCount: 5,
      planningCalls: 1,
      planningProviderRequestCount: 3,
      planningEstimatedRequestBytes: 987,
    });
  });

  it('does not save a manual workflow when Jev selects a recurring trigger', async () => {
    const result = await routeChatWithJev({
      decisionEngine: {
        evaluate: async () => ({
          answers: {
            route: {
              type: 'choice', choice: 'workflow_create',
              probabilities: { workflow_create: 0.95, answer: 0.05 }, confidence: 0.95,
            },
            explicit_workflow_create: { type: 'choice', choice: 'create_now', probabilities: { create_now: 0.99 }, confidence: 0.99 },
            workflow_trigger: {
              type: 'choice', choice: 'schedule',
              probabilities: { schedule: 0.99, none: 0.01 }, confidence: 0.99,
            },
          },
        }),
      },
      userMessage: '매일 Gmail 메일을 확인하는 workflow를 저장해줘',
      hasWorkspaceSession: true,
    });

    expect(result).toMatchObject({ kind: 'clarify', route: 'workflow_create' });
    if (result.kind !== 'clarify') throw new Error('expected recurring-work clarification');
    expect(result.message).toContain('반복 시작 조건');
  });

  it.each(['none', 'missing'] as const)(
    'does not treat an unclear workflow start mode as permission for manual creation: %s',
    async (triggerChoice) => {
      let planningCalls = 0;
      const result = await routeChatWithJev({
        decisionEngine: {
          evaluate: async (request) => {
            if (request.questions.route) return { answers: {
              route: {
                type: 'choice', choice: 'workflow_create',
                probabilities: { workflow_create: 0.95, answer: 0.05 }, confidence: 0.95,
              },
              explicit_workflow_create: { type: 'choice', choice: 'create_now', probabilities: { create_now: 0.99 }, confidence: 0.99 },
              ...(triggerChoice === 'missing' ? {} : {
                workflow_trigger: {
                  type: 'choice' as const, choice: 'none',
                  probabilities: { none: 0.99, manual: 0.01 }, confidence: 0.99,
                },
              }),
            } };
            planningCalls += 1;
            return { answers: {
              next_step: { type: 'choice', choice: 'done', probabilities: { done: 0.99 }, confidence: 0.99 },
            } };
          },
        },
        userMessage: '이 업무를 저장해줘.',
        hasWorkspaceSession: true,
      });

      expect(result).toMatchObject({ kind: 'clarify', route: 'workflow_create' });
      expect(planningCalls).toBe(0);
    },
  );

  it('lets Jev propose a schedule and defers its missing values to host validation', async () => {
    let planningCalls = 0;
    const search = {
      key: 'op_0', capabilityId: 'gmail.messages.search', connector: 'gmail',
      label: 'Gmail 메일 검색', description: 'Gmail 메일 검색', params: {},
    };
    const result = await routeChatWithJev({
      decisionEngine: {
        evaluate: async (request) => {
          if (request.questions.route) {
            return { answers: {
              route: {
                type: 'choice', choice: 'job_propose',
                probabilities: { job_propose: 0.99, answer: 0.01 }, confidence: 0.99,
              },
              workflow_trigger: {
                type: 'choice', choice: 'schedule',
                probabilities: { schedule: 0.99, none: 0.01 }, confidence: 0.99,
              },
            } };
          }
          planningCalls += 1;
          const criteria = request.questions.next_step?.type === 'choice' ? request.questions.next_step.criteria : {};
          const action = Object.entries(criteria).find(([, value]) =>
            typeof value === 'object' && value !== null && (value as { capability_id?: unknown }).capability_id === search.capabilityId,
          )?.[0];
          const choice = planningCalls === 1 ? action : 'done';
          if (!choice) throw new Error('expected planner candidate');
          return { answers: { next_step: {
            type: 'choice', choice, confidence: 0.99, probabilities: { [choice]: 0.99 },
          } } };
        },
      },
      userMessage: '매일 오전 9시에 Gmail 메일을 확인하는 반복 업무를 제안해줘.',
      connectedConnectors: ['gmail'],
      hasWorkspaceSession: true,
      readOperationHints: [search],
    });

    expect(result).toMatchObject({ kind: 'command', route: 'job_propose', command: {
      name: 'job.propose', args: { trigger: { type: 'schedule', schedule: '', timezone: '' } },
    } });
    expect(planningCalls).toBe(2);
  });

  it('uses Jev’s selected answer route even when confidence is low', async () => {
    const result = await routeChatWithJev({
      decisionEngine: {
        evaluate: async (request) => ({
          answers: {
            route: {
              type: 'choice',
              choice: 'answer',
              probabilities: { answer: 0.55, execution_enqueue_once: 0.45 },
              confidence: 0.55,
            },
            explicit_execution_now: { type: 'choice', choice: 'execute_now', probabilities: { execute_now: 0.99 }, confidence: 0.99 },
            ...(request.questions.explicit_workflow_run
              ? { explicit_workflow_run: { type: 'choice' as const, choice: 'do_not_run', probabilities: { do_not_run: 0.99 }, confidence: 0.99 } }
              : {}),
          },
        }),
      },
      userMessage: '상품 5개를 조회해서 재고 부족 상품만 정리하는 일회성 업무를 지금 실행해줘. 반복 업무로 저장하지는 마.',
    });

    expect(result).toEqual({ kind: 'reply', route: 'answer', confidence: 0.55 });
  });

  it('requires Jev to affirm immediate execution before queueing a negated request', async () => {
    const requests: Parameters<DecisionEngine['evaluate']>[0][] = [];
    const result = await routeChatWithJev({
      decisionEngine: {
        evaluate: async (request) => {
          requests.push(request);
          const criteria = request.questions.action?.type === 'choice'
            ? request.questions.action.criteria
            : {};
          const sendAction = Object.entries(criteria).find(([, criterion]) =>
            matchesAction(criterion, 'gmail', 'message.send'))?.[0] ?? 'none';
          return { answers: {
            route: {
              type: 'choice', choice: 'execution_enqueue_once',
              probabilities: { execution_enqueue_once: 0.6, answer: 0.4 }, confidence: 0.6,
            },
            explicit_execution_now: { type: 'choice', choice: 'do_not_execute', probabilities: { do_not_execute: 0.99 }, confidence: 0.99 },
            action_scope: {
              type: 'choice', choice: 'single_action',
              probabilities: { single_action: 0.52, multi_step: 0.24, unclear: 0.24 }, confidence: 0.52,
            },
            action: {
              type: 'choice', choice: sendAction,
              probabilities: { [sendAction]: 0.99, none: 0.01 }, confidence: 0.99,
            },
          } };
        },
      },
      userMessage: '이번만 Gmail로 메일을 전송하지 말고 초안만 보여줘.',
      connectedConnectors: ['gmail'],
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]!.questions).toHaveProperty('explicit_execution_now');
    expect(requests[0]!.questions).not.toHaveProperty('action');
    expect(result).toMatchObject({ kind: 'clarify', route: 'execution_enqueue_once' });
    if (result.kind !== 'clarify') throw new Error('expected an execution clarification');
    expect(result.message).toContain('아무 작업도 등록하지 않았습니다');
  });

  it('allows a connected draft action when Jev confirms that execution is requested now', async () => {
    const result = await routeChatWithJev({
      decisionEngine: {
        evaluate: async (request) => {
          const criteria = request.questions.action?.type === 'choice'
            ? request.questions.action.criteria
            : {};
          const draftAction = Object.entries(criteria).find(([, criterion]) =>
            matchesAction(criterion, 'gmail', 'draft.create'))?.[0] ?? 'none';
          return { answers: {
            route: {
              type: 'choice', choice: 'execution_enqueue_once',
              probabilities: { execution_enqueue_once: 0.99, answer: 0.01 }, confidence: 0.99,
            },
            explicit_execution_now: { type: 'choice', choice: 'execute_now', probabilities: { execute_now: 0.99 }, confidence: 0.99 },
            action_scope: {
              type: 'choice', choice: 'single_action',
              probabilities: { single_action: 0.99, multi_step: 0.005, unclear: 0.005 }, confidence: 0.99,
            },
            action: {
              type: 'choice', choice: draftAction,
              probabilities: { [draftAction]: 0.99, none: 0.01 }, confidence: 0.99,
            },
          } };
        },
      },
      userMessage: '이번만 Gmail에서 메일 초안을 만들어줘.',
      connectedConnectors: ['gmail'],
    });

    expect(result).toMatchObject({
      kind: 'command',
      route: 'execution_enqueue_once',
      command: { name: 'execution.enqueue_once' },
    });
  });

  it('routes a natural-language write action before sending Jev the tool catalog', async () => {
    const requests: Parameters<DecisionEngine['evaluate']>[0][] = [];
    const result = await routeChatWithJev({
      decisionEngine: {
        evaluate: async (request) => {
          requests.push(request);
          const criteria = request.questions.action?.type === 'choice'
            ? request.questions.action.criteria
            : {};
          const draftAction = Object.entries(criteria).find(([, criterion]) =>
            matchesAction(criterion, 'gmail', 'draft.create'))?.[0] ?? 'none';
          return { answers: {
            route: {
              type: 'choice', choice: 'execution_enqueue_once',
              probabilities: { execution_enqueue_once: 0.99, answer: 0.01 }, confidence: 0.99,
            },
            explicit_execution_now: { type: 'choice', choice: 'execute_now', probabilities: { execute_now: 0.99 }, confidence: 0.99 },
            action_scope: {
              type: 'choice', choice: 'single_action',
              probabilities: { single_action: 0.99, multi_step: 0.005, unclear: 0.005 }, confidence: 0.99,
            },
            action: {
              type: 'choice', choice: draftAction,
              probabilities: { [draftAction]: 0.99, none: 0.01 }, confidence: 0.99,
            },
          }, providerRequestCount: 3 };
        },
      },
      userMessage: 'Gmail에 답장 초안 부탁해',
      connectedConnectors: ['gmail'],
    });

    expect(deriveJevRequestFeatures('Gmail에 답장 초안 부탁해')).toEqual({});
    expect(requests).toHaveLength(2);
    expect(requests[0]!.questions).toHaveProperty('route');
    expect(requests[0]!.questions).not.toHaveProperty('action');
    expect(requests[0]!.questions).toHaveProperty('explicit_execution_now');
    expect(requests[0]!.questions).toHaveProperty('action_scope');
    expect(requests[1]!.questions).not.toHaveProperty('explicit_execution_now');
    expect(requests[1]!.questions).toHaveProperty('action');
    expect(result).toMatchObject({ kind: 'command', route: 'execution_enqueue_once', command: { name: 'execution.enqueue_once' } });
    expect(result.telemetry?.evaluationCalls).toBe(2);
    expect(result.telemetry?.providerRequestCount).toBe(6);
  });

  it('does not treat a quoted tool name as an input value when the action accepts no inputs', async () => {
    clearDynamicCatalogForTests();
    const capability: ConnectorCapability = {
      id: 'test.no_input_action',
      connector: 'test',
      kind: 'write',
      label: 'No-input action',
      description: 'A synthetic action that accepts no parameters.',
      sideEffect: 'EXTERNAL',
      params: [],
    };
    registerDynamicCapabilities([capability]);
    const requests: Parameters<DecisionEngine['evaluate']>[0][] = [];
    try {
      const result = await routeChatWithJev({
        decisionEngine: {
          evaluate: async (request) => {
            requests.push(request);
            if (request.questions.route) {
              return { answers: {
                route: {
                  type: 'choice', choice: 'execution_enqueue_once',
                  probabilities: { execution_enqueue_once: 0.99 }, confidence: 0.99,
                },
                explicit_execution_now: { type: 'choice', choice: 'execute_now', probabilities: { execute_now: 0.99 }, confidence: 0.99 },
                action_scope: {
                  type: 'choice', choice: 'single_action',
                  probabilities: { single_action: 0.99 }, confidence: 0.99,
                },
              } };
            }
            const action = request.questions.action;
            const selected = action?.type === 'choice'
              ? Object.entries(action.criteria).find(([, criterion]) =>
                  matchesAction(criterion, capability.connector, 'no_input_action'))?.[0]
              : undefined;
            return { answers: {
              action: {
                type: 'choice', choice: selected ?? 'none',
                probabilities: { [selected ?? 'none']: 0.99 }, confidence: 0.99,
              },
            } };
          },
        },
        userMessage: 'Run the connected action named "No-input action" now as a one-off.',
        connectedConnectors: ['test'],
      });

      expect(result).toMatchObject({
        kind: 'command',
        command: { name: 'execution.enqueue_once', args: { steps: [{ connector: 'test', action: 'no_input_action', params: {} }] } },
      });
      expect(requests).toHaveLength(2);
      expect(requests.some(({ questions }) => Object.hasOwn(questions, 'action_input_0'))).toBe(false);
    } finally {
      clearDynamicCatalogForTests();
    }
  });

  it('does not treat Korean role particles as a supplied write-action value', async () => {
    const result = await routeChatWithJev({
      decisionEngine: {
        evaluate: async (request) => {
          const criteria = request.questions.action?.type === 'choice'
            ? request.questions.action.criteria
            : {};
          const sendAction = Object.entries(criteria).find(([, criterion]) =>
            matchesAction(criterion, 'gmail', 'message.send'))?.[0] ?? 'none';
          return { answers: {
            route: {
              type: 'choice', choice: 'execution_enqueue_once',
              probabilities: { execution_enqueue_once: 0.99, answer: 0.01 }, confidence: 0.99,
            },
            explicit_execution_now: { type: 'choice', choice: 'execute_now', probabilities: { execute_now: 0.99 }, confidence: 0.99 },
            action_scope: {
              type: 'choice', choice: 'single_action',
              probabilities: { single_action: 0.99, multi_step: 0.005, unclear: 0.005 }, confidence: 0.99,
            },
            action: {
              type: 'choice', choice: sendAction,
              probabilities: { [sendAction]: 0.99, none: 0.01 }, confidence: 0.99,
            },
          } };
        },
      },
      userMessage: '이번만 수신자에게 메일을 보내줘. 지금 실행해줘.',
      connectedConnectors: ['gmail'],
    });

    expect(result.kind).toBe('command');
    if (result.kind !== 'command') throw new Error('expected the selected Gmail action');
    expect(result.command.args.steps?.[0]).toMatchObject({ connector: 'gmail', action: 'message.send' });
    expect(result.command.args.steps?.[0]?.params).not.toHaveProperty('to');
  });

  it('does not compile a quoted write value when Jev cannot identify its input field', async () => {
    const requests: Parameters<DecisionEngine['evaluate']>[0][] = [];
    const result = await routeChatWithJev({
      decisionEngine: {
        evaluate: async (request) => {
          requests.push(request);
          if (request.questions.action_input_0?.type === 'choice') {
            return { answers: {
              action_input_0: { type: 'choice', choice: 'none', probabilities: { none: 0.99 }, confidence: 0.99 },
            } };
          }
          const criteria = request.questions.action?.type === 'choice'
            ? request.questions.action.criteria
            : {};
          const sendAction = Object.entries(criteria).find(([, criterion]) =>
            matchesAction(criterion, 'gmail', 'message.send'))?.[0] ?? 'none';
          return { answers: {
            route: {
              type: 'choice', choice: 'execution_enqueue_once',
              probabilities: { execution_enqueue_once: 0.99, answer: 0.01 }, confidence: 0.99,
            },
            explicit_execution_now: { type: 'choice', choice: 'execute_now', probabilities: { execute_now: 0.99 }, confidence: 0.99 },
            action_scope: {
              type: 'choice', choice: 'single_action',
              probabilities: { single_action: 0.99, multi_step: 0.005, unclear: 0.005 }, confidence: 0.99,
            },
            action: {
              type: 'choice', choice: sendAction,
              probabilities: { [sendAction]: 0.99, none: 0.01 }, confidence: 0.99,
            },
          } };
        },
      },
      userMessage: '이번만 person@example.com에게 "견적서 발송 안내"를 포함해서 메일을 보내줘. 일회성으로 실행해줘.',
      connectedConnectors: ['gmail'],
    });

    expect(requests).toHaveLength(3);
    const inputQuestion = requests[2]!.questions.action_input_0;
    expect(inputQuestion?.type).toBe('choice');
    if (inputQuestion?.type === 'choice') {
      expect(Object.keys(inputQuestion.criteria)).toEqual(['none', 'field_0', 'field_1']);
      expect(Object.values(inputQuestion.criteria)).not.toContainEqual(expect.objectContaining({ parameter_name: 'to' }));
    }
    expect(result).toMatchObject({ kind: 'clarify', route: 'execution_enqueue_once' });
    expect(result).not.toHaveProperty('command');
  });

  it('uses Jev’s semantic execution choice without an arbitrary confidence cutoff', async () => {
    const result = await routeChatWithJev({
      decisionEngine: {
        evaluate: async (request) => {
          const criteria = request.questions.action?.type === 'choice'
            ? request.questions.action.criteria
            : {};
          const draftAction = Object.entries(criteria).find(([, criterion]) =>
            matchesAction(criterion, 'gmail', 'draft.create'))?.[0] ?? 'none';
          return { answers: {
            route: {
              type: 'choice', choice: 'execution_enqueue_once',
              probabilities: { execution_enqueue_once: 0.6, answer: 0.4 }, confidence: 0.6,
            },
            explicit_execution_now: { type: 'choice', choice: 'execute_now', probabilities: { execute_now: 0.52, do_not_execute: 0.24, unclear: 0.24 }, confidence: 0.52 },
            action_scope: {
              type: 'choice', choice: 'single_action',
              probabilities: { single_action: 0.52, multi_step: 0.24, unclear: 0.24 }, confidence: 0.52,
            },
            action: {
              type: 'choice', choice: draftAction,
              probabilities: { [draftAction]: 0.99, none: 0.01 }, confidence: 0.99,
            },
          } };
        },
      },
      userMessage: 'Gmail에 답장 초안 부탁해',
      connectedConnectors: ['gmail'],
    });

    expect(result).toMatchObject({ kind: 'command', route: 'execution_enqueue_once', command: { name: 'execution.enqueue_once' } });
  });

  it('rejects workflow update and delete choices when there is no current workflow', async () => {
    await expect(routeChatWithJev({
      decisionEngine: engineFor('workflow_update'),
      userMessage: '현재 workflow의 이름을 바꿔줘',
    })).resolves.toEqual({ kind: 'fallback', reason: 'unsupported' });
    await expect(routeChatWithJev({
      decisionEngine: {
        evaluate: async () => ({
          answers: {
            route: {
              type: 'choice', choice: 'workflow_delete',
              probabilities: { workflow_delete: 0.99, answer: 0.01 }, confidence: 0.99,
            },
            explicit_workflow_delete: { type: 'choice', choice: 'delete_now', probabilities: { delete_now: 0.99 }, confidence: 0.99 },
          },
        }),
      },
      userMessage: '현재 workflow를 삭제해줘',
    })).resolves.toEqual({ kind: 'fallback', reason: 'unsupported' });
  });

  it.each([
    {
      route: 'workflow_create', intentQuestion: 'explicit_workflow_create', deniedChoice: 'do_not_create',
      context: { hasWorkspaceSession: true },
    },
    {
      route: 'workflow_update', intentQuestion: 'explicit_workflow_update', deniedChoice: 'do_not_update',
      context: { currentWorkflowId: 'workflow-current', currentWorkflowVersion: 4 },
    },
    {
      route: 'workflow_delete', intentQuestion: 'explicit_workflow_delete', deniedChoice: 'do_not_delete',
      context: { currentWorkflowId: 'workflow-current', currentWorkflowVersion: 4 },
    },
  ] as const)('does not mutate when Jev selects $deniedChoice for $route', async ({ route, intentQuestion, deniedChoice, context }) => {
    const result = await routeChatWithJev({
      decisionEngine: {
        evaluate: async () => ({
          answers: {
            route: { type: 'choice', choice: route, probabilities: { [route]: 0.99 }, confidence: 0.99 },
            [intentQuestion]: {
              type: 'choice', choice: deniedChoice,
              probabilities: { [deniedChoice]: 0.99 }, confidence: 0.99,
            },
          },
        }),
      },
      userMessage: 'workflow를 어떻게 처리할지 설명해줘.',
      ...context,
    });

    expect(result).toMatchObject({ kind: 'clarify', route });
    expect(result).not.toHaveProperty('command');
  });

  it('compiles an explicit delete against the host-provided current workflow version', async () => {
    const result = await routeChatWithJev({
      decisionEngine: {
        evaluate: async () => ({
          answers: {
            route: {
              type: 'choice', choice: 'workflow_delete',
              probabilities: { workflow_delete: 0.4, answer: 0.6 }, confidence: 0.4,
            },
            explicit_workflow_delete: { type: 'choice', choice: 'delete_now', probabilities: { delete_now: 0.99 }, confidence: 0.99 },
          },
        }),
      },
      currentWorkflowId: 'workflow-current',
      currentWorkflowVersion: 4,
      userMessage: '현재 workflow를 삭제해줘',
    });

    expect(result).toMatchObject({
      kind: 'command', route: 'workflow_delete',
      command: {
        name: 'workflow.delete',
        args: { workflowId: 'workflow-current', baseVersion: 4 },
      },
    });
  });

  it('compiles a quoted workflow field update without delegating payload generation', async () => {
    const result = await routeChatWithJev({
      decisionEngine: {
        evaluate: async () => ({
          answers: {
            route: {
              type: 'choice', choice: 'workflow_update',
              probabilities: { workflow_update: 0.4, answer: 0.6 }, confidence: 0.4,
            },
            explicit_workflow_update: { type: 'choice', choice: 'update_now', probabilities: { update_now: 0.54, unclear: 0.46 }, confidence: 0.54 },
            explicit_workflow_step_addition: { type: 'choice', choice: 'do_not_add', probabilities: { do_not_add: 0.99 }, confidence: 0.99 },
          },
        }),
      },
      currentWorkflowId: 'workflow-current',
      currentWorkflowVersion: 4,
      userMessage: '현재 workflow 이름을 "주간 재고 요약"으로 바꿔줘',
    });

    expect(result).toMatchObject({
      kind: 'command', route: 'workflow_update',
      command: {
        name: 'workflow.update',
        args: {
          workflowId: 'workflow-current',
          baseVersion: 4,
          operations: [{ op: 'set', path: 'name', value: '주간 재고 요약' }],
        },
      },
    });
  });

  it('does not spend a second Jev call when workflow change is not step removal', async () => {
    let evaluations = 0;
    const result = await routeChatWithJev({
      decisionEngine: {
        evaluate: async ({ questions }) => {
          evaluations += 1;
          expect(questions).not.toHaveProperty('workflow_step_to_remove');
          return {
            answers: {
              route: {
                type: 'choice', choice: 'workflow_update',
                probabilities: { workflow_update: 0.99, answer: 0.01 }, confidence: 0.99,
              },
              explicit_workflow_update: { type: 'choice', choice: 'update_now', probabilities: { update_now: 0.99 }, confidence: 0.99 },
              explicit_workflow_step_addition: { type: 'choice', choice: 'do_not_add', probabilities: { do_not_add: 0.99 }, confidence: 0.99 },
              explicit_workflow_step_removal: { type: 'choice', choice: 'do_not_remove', probabilities: { do_not_remove: 0.99 }, confidence: 0.99 },
            },
          };
        },
      },
      currentWorkflowId: 'workflow-current',
      currentWorkflowVersion: 4,
      currentWorkflowSteps: [{ id: 'notify', type: 'action', label: 'Slack 알림' }],
      userMessage: '현재 workflow 이름을 "주간 재고 요약"으로 바꿔줘',
    });

    expect(result).toMatchObject({ kind: 'command', route: 'workflow_update' });
    expect(evaluations).toBe(1);
  });

  it('lets Jev select an existing workflow step for explicit removal', async () => {
    let evaluations = 0;
    const result = await routeChatWithJev({
      decisionEngine: {
        evaluate: async ({ questions }) => {
          evaluations += 1;
          if (questions.route) {
            expect(questions).not.toHaveProperty('workflow_step_to_remove');
            expect(questions).toHaveProperty('explicit_workflow_step_removal');
            return {
              answers: {
                route: {
                  type: 'choice', choice: 'workflow_update',
                  probabilities: { workflow_update: 0.99, answer: 0.01 }, confidence: 0.99,
                },
                explicit_workflow_update: { type: 'choice', choice: 'update_now', probabilities: { update_now: 0.99 }, confidence: 0.99 },
                explicit_workflow_step_addition: { type: 'choice', choice: 'do_not_add', probabilities: { do_not_add: 0.99 }, confidence: 0.99 },
                explicit_workflow_step_removal: { type: 'choice', choice: 'remove_now', probabilities: { remove_now: 0.99 }, confidence: 0.99 },
              },
            };
          }
          expect(questions.workflow_step_to_remove).toBeDefined();
          expect(questions).not.toHaveProperty('explicit_workflow_step_removal');
          return {
            answers: {
              workflow_step_to_remove: {
                type: 'choice', choice: 'step_1',
                probabilities: { step_1: 0.54, none: 0.46 }, confidence: 0.54,
              },
            },
          };
        },
      },
      currentWorkflowId: 'workflow-current',
      currentWorkflowVersion: 7,
      currentWorkflowSteps: [
        { id: 'fetch_orders', type: 'action', label: 'http / orders.list' },
        { id: 'notify_slack', type: 'action', label: 'slack / messages.send' },
      ],
      userMessage: '현재 workflow의 Slack 알림은 이제 필요 없어.',
    });

    expect(result).toMatchObject({
      kind: 'command', route: 'workflow_update',
      command: {
        name: 'workflow.update',
        args: {
          workflowId: 'workflow-current',
          baseVersion: 7,
          operations: [{ op: 'remove_step', stepId: 'notify_slack' }],
        },
      },
    });
    expect(evaluations).toBe(2);
  });

  it.each(['step_00', `step_${MAX_DECISION_CHOICE_CRITERIA - 1}`])('rejects a workflow-step choice not offered to Jev: %s', async (choice) => {
    let evaluations = 0;
    const result = await routeChatWithJev({
      decisionEngine: {
        evaluate: async ({ questions }) => {
          evaluations += 1;
          if (questions.route) return {
            answers: {
              route: {
                type: 'choice', choice: 'workflow_update',
                probabilities: { workflow_update: 0.99, answer: 0.01 }, confidence: 0.99,
              },
              explicit_workflow_update: { type: 'choice', choice: 'update_now', probabilities: { update_now: 0.99 }, confidence: 0.99 },
              explicit_workflow_step_addition: { type: 'choice', choice: 'do_not_add', probabilities: { do_not_add: 0.99 }, confidence: 0.99 },
              explicit_workflow_step_removal: { type: 'choice', choice: 'remove_now', probabilities: { remove_now: 0.99 }, confidence: 0.99 },
            },
          };
          return {
            answers: {
              workflow_step_to_remove: {
                type: 'choice', choice,
                probabilities: { [choice]: 0.99, none: 0.01 }, confidence: 0.99,
              },
            },
          };
        },
      },
      currentWorkflowId: 'workflow-current',
      currentWorkflowVersion: 7,
      currentWorkflowSteps: Array.from({ length: MAX_DECISION_CHOICE_CRITERIA - 1 }, (_, index) => ({
        id: `step-${index}`,
        type: 'action',
        label: `action ${index}`,
      })),
      userMessage: '현재 workflow에서 action 단계는 더 이상 필요 없어.',
    });

    expect(result.kind).toBe('clarify');
    expect(evaluations).toBe(2);
  });

  it('does not make an empty Jev follow-up when the workflow has no steps', async () => {
    let evaluations = 0;
    const result = await routeChatWithJev({
      decisionEngine: {
        evaluate: async () => {
          evaluations += 1;
          return {
            answers: {
              route: {
                type: 'choice', choice: 'workflow_update',
                probabilities: { workflow_update: 0.99, answer: 0.01 }, confidence: 0.99,
              },
              explicit_workflow_update: { type: 'choice', choice: 'update_now', probabilities: { update_now: 0.99 }, confidence: 0.99 },
              explicit_workflow_step_addition: { type: 'choice', choice: 'do_not_add', probabilities: { do_not_add: 0.99 }, confidence: 0.99 },
              explicit_workflow_step_removal: { type: 'choice', choice: 'remove_now', probabilities: { remove_now: 0.99 }, confidence: 0.99 },
            },
          };
        },
      },
      currentWorkflowId: 'workflow-current',
      currentWorkflowVersion: 7,
      currentWorkflowSteps: [],
      userMessage: '현재 workflow에서 마지막 단계를 제거해줘.',
    });

    expect(result.kind).toBe('clarify');
    expect(evaluations).toBe(1);
  });

  it('lets Jev remove an exact step from a workflow larger than one choice group', async () => {
    const steps = Array.from({ length: MAX_DECISION_CHOICE_CRITERIA + 1 }, (_, index) => ({
      id: `step-${index}`,
      type: 'action',
      label: `workflow action ${index}`,
    }));
    const selectedIndex = steps.length - 1;
    let evaluations = 0;
    const result = await routeChatWithJev({
      decisionEngine: {
        evaluate: async ({ questions }) => {
          evaluations += 1;
          if (questions.route) return {
            answers: {
              route: {
                type: 'choice', choice: 'workflow_update',
                probabilities: { workflow_update: 0.99, answer: 0.01 }, confidence: 0.99,
              },
              explicit_workflow_update: { type: 'choice', choice: 'update_now', probabilities: { update_now: 0.99 }, confidence: 0.99 },
              explicit_workflow_step_addition: { type: 'choice', choice: 'do_not_add', probabilities: { do_not_add: 0.99 }, confidence: 0.99 },
              explicit_workflow_step_removal: { type: 'choice', choice: 'remove_now', probabilities: { remove_now: 0.99 }, confidence: 0.99 },
            },
          };

          const answers = Object.fromEntries(Object.entries(questions).map(([questionId, question]) => {
            const keys = Object.keys(question.criteria ?? {}).filter((key) => /^step_\d+$/u.test(key));
            const selectedKey = `step_${selectedIndex}`;
            const choice = keys.includes(selectedKey)
              ? selectedKey
              : evaluations === 2 && keys.includes('step_0') ? 'step_0' : 'none';
            return [questionId, {
              type: 'choice' as const,
              choice,
              probabilities: { [choice]: 0.99 },
              confidence: 0.99,
            }];
          }));
          return { answers };
        },
      },
      currentWorkflowId: 'workflow-current',
      currentWorkflowVersion: 7,
      currentWorkflowSteps: steps,
      userMessage: '현재 workflow에서 마지막 단계를 제거해줘.',
    });

    expect(result).toMatchObject({
      kind: 'command',
      route: 'workflow_update',
      command: {
        name: 'workflow.update',
        args: {
          workflowId: 'workflow-current',
          baseVersion: 7,
          operations: [{ op: 'remove_step', stepId: `step-${selectedIndex}` }],
        },
      },
    });
    expect(evaluations).toBe(3);
  });

  it('uses the Jev chat router and workflow planner to add a connected step to the current workflow', async () => {
    clearDynamicCatalogForTests();
    const capability: ConnectorCapability = {
      id: 'test.messages.send',
      connector: 'test',
      kind: 'write',
      label: 'Send test message',
      description: 'Send a message using the connected test service.',
      sideEffect: 'EXTERNAL',
      params: [],
      io: {
        inputs: { records: 'JsonArtifact' },
        outputs: { receipt: 'JsonArtifact' },
      },
    };
    registerDynamicCapabilities([capability]);
    const result = await routeChatWithJev({
      decisionEngine: {
        evaluate: async ({ state, questions }) => {
          if (questions.route) return {
            answers: {
              route: {
                type: 'choice', choice: 'workflow_update',
                probabilities: { workflow_update: 0.99, answer: 0.01 }, confidence: 0.99,
              },
              explicit_workflow_update: { type: 'choice', choice: 'update_now', probabilities: { update_now: 0.99 }, confidence: 0.99 },
              explicit_workflow_step_addition: { type: 'choice', choice: 'add_now', probabilities: { add_now: 0.99 }, confidence: 0.99 },
              explicit_workflow_step_removal: { type: 'choice', choice: 'do_not_remove', probabilities: { do_not_remove: 0.99 }, confidence: 0.99 },
            },
          };

          const planningState = state as { planned_steps?: unknown[] };
          const planned = (planningState.planned_steps?.length ?? 0) > 0;
          const question = questions.next_step;
          if (question?.type !== 'choice') return { answers: {} };
          const choice = planned
            ? 'done'
            : Object.entries(question.criteria).find(([, criterion]) =>
                typeof criterion === 'object' && criterion !== null
                  && 'capability_id' in criterion && criterion.capability_id === capability.id,
              )?.[0] ?? 'none';
          return {
            answers: {
              next_step: {
                type: 'choice', choice,
                probabilities: { [choice]: 0.99 }, confidence: 0.99,
              },
            },
          };
        },
      },
      connectedConnectors: ['test'],
      currentWorkflowId: 'workflow-current',
      currentWorkflowVersion: 4,
      currentWorkflowSteps: [{ id: 'jev_step_1', type: 'action', label: 'Existing step' }],
      currentWorkflowOutputs: [{
        from: 'jev_step_1', output: 'records', type: 'JsonArtifact', capabilityId: 'test.orders.list',
      }],
      userMessage: '현재 workflow에 테스트 메시지 전송 단계를 추가해줘.',
    });

    expect(result).toMatchObject({
      kind: 'command',
      route: 'workflow_update',
      command: {
        name: 'workflow.update',
        args: {
          workflowId: 'workflow-current',
          baseVersion: 4,
          operations: [{
            op: 'upsert_step',
            step: {
              type: 'action',
              id: 'jev_step_2',
              connector: 'test',
              action: 'messages.send',
              bindings: { records: { from: 'jev_step_1', output: 'records' } },
            },
          }],
        },
      },
    });
    expect(result.telemetry?.planningCalls).toBe(2);
  });

  it('requires Jev confirmation before a workflow run', async () => {
    const result = await routeChatWithJev({
      decisionEngine: engineFor('workflow_run', 0.99, 'do_not_run'),
      currentWorkflowId: 'workflow-1',
      userMessage: 'workflow를 실행하지 말고 검토만 해줘',
    });

    expect(result).toEqual({ kind: 'fallback', reason: 'uncertain' });
  });

  it.each([
    '현재 workflow를 실행하는 방법 알려줘',
    'workflow 실행 방법을 설명해줘',
    'Can you explain how to run the current workflow?',
    '현재 workflow의 실행 결과를 보여줘',
    '현재 workflow의 지난 실행 기록을 확인해줘',
    '현재 workflow를 실행해줘 말고 실행 방법만 알려줘',
    "Please run the current workflow, actually don't; explain how instead.",
  ])('does not run a workflow when the message does not ask for execution: %s', async (userMessage) => {
    const result = await routeChatWithJev({
      decisionEngine: engineFor('workflow_run', 0.99, 'do_not_run'),
      currentWorkflowId: 'workflow-1',
      userMessage,
    });

    expect(result).toEqual({ kind: 'fallback', reason: 'uncertain' });
  });

  it.each([
    '현재 workflow를 지금 실행해줘',
    '현재 workflow를 실행해줘요.',
    '현재 workflow를 돌려줘',
    '현재 workflow를 시작해줘',
    '아까 정한 업무, 이제 진행하자.',
    'Run the current workflow now.',
  ])('returns the selected workflow run only after Jev confirms intent: %s', async (userMessage) => {
    const result = await routeChatWithJev({
      decisionEngine: engineFor('workflow_run', 0.99, 'run_now'),
      currentWorkflowId: 'workflow-1',
      userMessage,
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
