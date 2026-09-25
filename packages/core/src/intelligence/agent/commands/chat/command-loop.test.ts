import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import { AgentHarness } from '../../harness.js';
import type { ModelProvider, StructuredGenerateInput, TextGenerateInput } from '../../model/provider.js';
import { ArtifactStore } from '../../../../persistence/artifact-store.js';
import { createDatabaseAsync } from '../../../../persistence/db.js';
import { WorkflowStore } from '../../../../persistence/workflow-store.js';
import { WorkspaceSourceService } from '../../../../persistence/workspace-source-service.js';
import { WorkflowRuntime } from '../../../../runtime/engine.js';
import { createTestConnectors, mockGmail } from '../../../../testing/connectors/test-connectors.js';
import { runAxCommandChat } from '../chat.js';
import { createDesignToolReadGateway } from '../read-gateway.js';
import { AxCommandService } from '../service.js';
import { scriptedModel } from './fixtures.js';
import { commandChatContext } from '../service/fixtures.js';
import { MAX_DECISION_CHOICE_CRITERIA, type DecisionEngine } from '../../../../contracts/decision.js';
import { buildHttpResponseArtifact } from '../../../../contracts/artifacts/http-response.js';
import { buildTableArtifact } from '../../../../contracts/artifacts/table-build.js';
import { buildDesignToolContext } from '../../../design-tools/context.js';
import { buildJevReadOperationIndex } from '../../../decision/read-operation-catalog.js';
import { JevDecisionEngine } from '../../../decision/jev.js';
import { httpEndpointSelectionValue } from './connection-selection/http-endpoint-selection.js';
import type { AxCommand, AxInputRequest } from '../schema.js';
import { clearDynamicCatalogForTests, registerDynamicCapabilities } from '../../../../catalog/dynamic-catalog.js';
import type { ConnectorCapability } from '../../../../catalog/capability-types.js';

function matchesAction(criterion: unknown, connector: string, action: string): boolean {
  return typeof criterion === 'string' && criterion.startsWith(`${connector}.${action} —`);
}

vi.mock('../../../../persistence/paths/app-log.js', () => ({ appendAppLog: vi.fn() }));
import { appendAppLog } from '../../../../persistence/paths/app-log.js';

describe('runAxCommandChat command loop', () => {
  it('lets Jev transform the immediately previous table without another connector call', async () => {
    const db = await createDatabaseAsync(':memory:');
    const service = new AxCommandService(new WorkflowStore(db));
    const execute = vi.spyOn(service, 'execute');
    const previousReadResult = buildTableArtifact({
      id: 'products',
      headers: ['title', 'price', 'stock'],
      matrix: [['A', 50, 45], ['B', 10, 20], ['C', 20, 5]],
    });
    const decisionEngine: DecisionEngine = {
      evaluate: async ({ state, questions }) => {
        if (questions.route) {
          const route = questions.route;
          const routeChoice = route?.type === 'choice' && Object.hasOwn(route.criteria, 'previous_result')
            ? 'previous_result'
            : 'answer';
          return { answers: { route: { type: 'choice', choice: routeChoice, probabilities: { [routeChoice]: 0.99 } } } };
        }
        const fieldChoice = (questionId: string, field: string) => {
          const question = questions[questionId];
          if (question?.type !== 'choice') return 'none';
          return Object.entries(question.criteria).find(([, criterion]) =>
            typeof criterion === 'object' && criterion !== null && criterion.field === field,
          )?.[0] ?? 'none';
        };
        const valueChoice = Object.entries(questions.filter_value?.type === 'choice'
          ? questions.filter_value.criteria
          : {}).find(([, criterion]) =>
          typeof criterion === 'object' && criterion !== null && 'value' in criterion && criterion.value === 30,
        )?.[0] ?? 'none';
        return { answers: {
          table_transform: { type: 'choice', choice: 'filter_sort', probabilities: { filter_sort: 0.99 } },
          filter_column: { type: 'choice', choice: fieldChoice('filter_column', 'stock'), probabilities: {} },
          filter_operator: { type: 'choice', choice: 'lt', probabilities: { lt: 0.99 } },
          filter_value: { type: 'choice', choice: valueChoice, probabilities: { [valueChoice]: 0.99 } },
          sort_column: { type: 'choice', choice: fieldChoice('sort_column', 'price'), probabilities: {} },
          sort_direction: { type: 'choice', choice: 'asc', probabilities: { asc: 0.99 } },
        } };
      },
    };
    const harness = new AgentHarness(scriptedModel([], [], 'test-provider'));
    const reply = await runAxCommandChat({
      harness,
      commandService: service,
      decisionEngine,
      messages: [],
      userMessage: '방금 결과에서 재고 30개 미만인 것만 가격 낮은 순으로 정리해줘.',
      previousReadResult,
    } as Parameters<typeof runAxCommandChat>[0]);

    expect(reply).toContain('| B | 10 | 20 |');
    expect(reply).toContain('| C | 20 | 5 |');
    expect(reply).not.toContain('| A |');
    expect(execute).not.toHaveBeenCalled();
    db.close();
  });

  it('reports configured model metadata without Jev or an LLM round trip', async () => {
    const db = await createDatabaseAsync(':memory:');
    const service = new AxCommandService(new WorkflowStore(db));
    const seen: StructuredGenerateInput<unknown>[] = [];
    const textSeen: TextGenerateInput[] = [];
    const decisionEngine: DecisionEngine = {
      evaluate: async () => { throw new Error('jev_should_not_run'); },
    };
    const harness = new AgentHarness(scriptedModel([], seen, 'test-provider', [], textSeen));
    const resolveReadOperationSelection = vi.fn(() => ({
      hints: [],
      totalCount: 0,
      catalogMayBeBounded: false,
      mode: 'empty_catalog' as const,
      lexicalMatchedOperationCount: 0,
      lexicalTopScore: 0,
    }));

    await expect(runAxCommandChat({
      harness,
      commandService: service,
      decisionEngine,
      resolveReadOperationSelection,
      messages: [],
      userMessage: '너의 모델은 뭐냐?',
    })).resolves.toContain('test-provider');
    expect(seen).toHaveLength(0);
    expect(textSeen).toHaveLength(0);
    expect(resolveReadOperationSelection).not.toHaveBeenCalled();
  });

  it.each(['안녕', '너 누구야?'])('routes casual chat through Jev and lets the LLM answer: %s', async (userMessage) => {
    const db = await createDatabaseAsync(':memory:');
    const service = new AxCommandService(new WorkflowStore(db));
    const execute = vi.spyOn(service, 'execute');
    const textSeen: TextGenerateInput[] = [];
    let evaluations = 0;
    const decisionEngine: DecisionEngine = {
      evaluate: async () => {
        evaluations += 1;
        return {
          answers: {
            route: { type: 'choice', choice: 'answer', probabilities: { answer: 0.98 }, confidence: 0.98 },
            explicit_workflow_run: { type: 'boolean', probability: 0.01 },
          },
        };
      },
    };
    const harness = new AgentHarness(scriptedModel(
      [], [], 'test-provider', ['안녕하세요! 오늘은 어떤 업무를 같이 해볼까요?'], textSeen,
    ));

    await expect(runAxCommandChat({
      harness,
      commandService: service,
      decisionEngine,
      messages: [],
      userMessage,
    })).resolves.toBe('안녕하세요! 오늘은 어떤 업무를 같이 해볼까요?');
    expect(evaluations).toBe(1);
    expect(textSeen).toHaveLength(1);
    expect(execute).not.toHaveBeenCalled();
    db.close();
  });

  it('uses Jev to select a safe read and renders its known list without an LLM turn', async () => {
    vi.mocked(appendAppLog).mockClear();
    const db = await createDatabaseAsync(':memory:');
    const service = new AxCommandService(new WorkflowStore(db));
    const execute = vi.spyOn(service, 'execute');
    const seen: StructuredGenerateInput<unknown>[] = [];
    const textSeen: TextGenerateInput[] = [];
    const jevStates: unknown[] = [];
    const decisionEngine: DecisionEngine = {
      evaluate: async (request) => {
        jevStates.push(request.state);
        return {
          model: 'mock-jev',
          providerRequestCount: 1,
          answers: {
            route: {
              type: 'choice',
              choice: 'workflow_list',
              probabilities: { workflow_list: 0.97, answer: 0.03 },
              confidence: 0.97,
            },
            explicit_workflow_run: { type: 'boolean', probability: 0.01 },
          },
        };
      },
    };
    const harness = new AgentHarness(scriptedModel([], seen, 'test-provider', [], textSeen));
    const resolveReadOperationSelection = vi.fn(() => ({
      hints: [{
        key: 'op_0',
        capabilityId: 'gmail.messages.search',
        connector: 'gmail' as const,
        label: 'Gmail mail search',
        description: 'Search messages in Gmail',
        params: {},
      }],
      totalCount: 37,
      catalogMayBeBounded: true,
      mode: 'lexical_relevance' as const,
      lexicalMatchedOperationCount: 3,
      lexicalTopScore: 2,
    }));

    await expect(runAxCommandChat({
      harness,
      commandService: service,
      decisionEngine,
      resolveReadOperationSelection,
      messages: [],
      requestId: 'chat-request-17',
      userMessage: '저장된 workflow 목록을 보여줘',
    })).resolves.toBe('저장된 workflow가 없습니다.');

    expect(execute).toHaveBeenCalledWith(
      { name: 'workflow.list', args: {} },
      expect.objectContaining({ userMessage: '저장된 workflow 목록을 보여줘' }),
    );
    expect(seen).toHaveLength(0);
    expect(textSeen).toHaveLength(0);
    expect(resolveReadOperationSelection).toHaveBeenCalledExactlyOnceWith();
    expect(jevStates[0]).toMatchObject({
      context: {
        read_operation_count: 1,
        read_operation_catalog_size: 37,
        read_operation_catalog_may_be_bounded: true,
      },
    });
    expect(appendAppLog).toHaveBeenCalledWith(
      'info',
      'Jev chat route timing recorded.',
      expect.objectContaining({
        requestId: 'chat-request-17',
        jevProviderRequestCount: 1,
        readOperationCatalogPreparationMs: expect.any(Number),
      }),
    );
    expect(appendAppLog).toHaveBeenCalledWith(
      'info',
      'Jev-selected read used a deterministic chat renderer.',
      expect.objectContaining({ requestId: 'chat-request-17', command: 'workflow.list' }),
    );
  });

  it('renders Jev-selected resource metadata without asking the LLM to paraphrase it', async () => {
    const db = await createDatabaseAsync(':memory:');
    try {
      const service = new AxCommandService(new WorkflowStore(db));
      const execute = vi.spyOn(service, 'execute');
      const textSeen: TextGenerateInput[] = [];
      const decisionEngine: DecisionEngine = {
        evaluate: async () => ({
          answers: {
            route: {
              type: 'choice', choice: 'resource_list',
              probabilities: { resource_list: 0.99, answer: 0.01 }, confidence: 0.99,
            },
          },
        }),
      };

      const reply = await runAxCommandChat({
        harness: new AgentHarness(scriptedModel([], [], 'test-provider', [], textSeen)),
        commandService: service,
        decisionEngine,
        messages: [],
        userMessage: '연결된 리소스 목록을 보여줘',
      });

      expect(execute).toHaveBeenCalledWith({ name: 'resource.list', args: {} }, expect.anything());
      expect(reply).toContain('"resources"');
      expect(reply).toContain('"local_folder"');
      expect(textSeen).toHaveLength(0);
    } finally {
      db.close();
    }
  });

  it('keeps the chat request id on provider and reply failure logs', async () => {
    vi.mocked(appendAppLog).mockClear();
    const db = await createDatabaseAsync(':memory:');
    try {
      const model: ModelProvider = {
        name: 'failing-provider',
        async generateStructured<T>(): Promise<T> {
          throw new Error('structured_generation_not_used');
        },
        async generateText(): Promise<string> {
          throw new Error('provider_unavailable');
        },
      };
      const decisionEngine: DecisionEngine = {
        evaluate: async () => ({
          model: 'mock-jev',
          providerRequestCount: 1,
          answers: {
            route: {
              type: 'choice',
              choice: 'answer',
              probabilities: { answer: 0.99 },
              confidence: 0.99,
            },
          },
        }),
      };

      await expect(runAxCommandChat({
        harness: new AgentHarness(model),
        commandService: new AxCommandService(new WorkflowStore(db)),
        decisionEngine,
        requestId: 'chat-failure-9',
        messages: [],
        userMessage: '현재 상태를 설명해줘',
      })).resolves.toBe('답변을 생성하지 못했습니다. 잠시 후 다시 시도해 주세요.');

      expect(appendAppLog).toHaveBeenCalledWith(
        'error',
        'Agent text invocation failed',
        expect.objectContaining({ requestId: 'chat-failure-9' }),
      );
      expect(appendAppLog).toHaveBeenCalledWith(
        'warn',
        'Chat text reply could not be generated; no command-model fallback will run.',
        expect.objectContaining({ requestId: 'chat-failure-9' }),
      );
    } finally {
      db.close();
    }
  });

  it('lets Jev map a quoted mail subject and asks for the missing body before queueing', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    store.setConnection('gmail', true, { email: 'primary' });
    const enqueueOnce = vi.fn(() => ({ jobId: 'one-shot-1' }));
    const service = new AxCommandService(store, { enqueueOnce });
    let evaluations = 0;
    const decisionEngine: DecisionEngine = {
      evaluate: async (request) => {
        evaluations += 1;
        const inputQuestion = request.questions.action_input_0;
        if (inputQuestion?.type === 'choice') {
          const subject = Object.entries(inputQuestion.criteria).find(([, criterion]) =>
            typeof criterion === 'object' && criterion !== null
              && 'parameter_name' in criterion && criterion.parameter_name === 'subject',
          )?.[0] ?? 'none';
          return { answers: {
            action_input_0: {
              type: 'choice', choice: subject,
              probabilities: { [subject]: 0.99 }, confidence: 0.99,
            },
          } };
        }
        const action = request.questions.action;
        const selectedAction = action?.type === 'choice'
          ? Object.entries(action.criteria).find(([, criterion]) => matchesAction(criterion, 'gmail', 'message.send'))
          : undefined;
        return {
          answers: {
            route: {
              type: 'choice',
              choice: 'execution_enqueue_once',
              probabilities: { execution_enqueue_once: 0.99, answer: 0.01 },
              confidence: 0.99,
            },
            explicit_execution_now: { type: 'choice', choice: 'execute_now', probabilities: { execute_now: 0.99 }, confidence: 0.99 },
            action_scope: {
              type: 'choice',
              choice: 'single_action',
              probabilities: { single_action: 0.99, multi_step: 0.005, unclear: 0.005 },
              confidence: 0.99,
            },
            action: {
              type: 'choice',
              choice: selectedAction?.[0] ?? 'none',
              probabilities: { [selectedAction?.[0] ?? 'none']: 0.99, none: selectedAction ? 0.01 : 0.99 },
              confidence: 0.99,
            },
          },
        };
      },
    };
    const seen: StructuredGenerateInput<unknown>[] = [];
    const textSeen: TextGenerateInput[] = [];
    const harness = new AgentHarness(scriptedModel([], seen, 'test-provider', [], textSeen));
    const commands: AxCommand[] = [];
    const inputRequests: AxInputRequest[] = [];

    await expect(runAxCommandChat({
      harness,
      commandService: service,
      decisionEngine,
      connectedConnectors: ['gmail'],
      messages: [],
      userMessage: '이번만 person@example.com에게 "견적서 발송 안내" 제목으로 메일을 보내줘. 일회성으로 실행해줘.',
      onCommandResult: (_result, command) => { if (command) commands.push(command); },
      onInputRequests: (requests) => inputRequests.push(...requests),
    })).resolves.toContain('실행에 필요한 정보를 입력해 주세요');

    expect(evaluations).toBe(3);
    expect(enqueueOnce).not.toHaveBeenCalled();
    expect(commands[0]?.args.steps).toMatchObject([{
      connector: 'gmail', action: 'message.send',
      params: { to: 'person@example.com', subject: '견적서 발송 안내' },
    }]);
    expect(commands[0]?.args.steps).not.toMatchObject([{ params: { body: '견적서 발송 안내' } }]);
    expect(inputRequests).toEqual(expect.arrayContaining([expect.objectContaining({ label: '본문', required: true })]));
    expect(seen).toHaveLength(0);
    expect(textSeen).toHaveLength(0);
    db.close();
  });

  it('routes more than 255 connected write tools through the production chat loop without an LLM call', async () => {
    const db = await createDatabaseAsync(':memory:');
    const service = new AxCommandService(new WorkflowStore(db));
    const execute = vi.spyOn(service, 'execute').mockResolvedValue({
      command: 'execution.enqueue_once', status: 'queued',
      data: { jobId: 'test-job', queued: true, ephemeral: true }, issues: [], inputRequests: [],
    });
    const textSeen: TextGenerateInput[] = [];
    const capabilities: ConnectorCapability[] = Array.from({ length: 260 }, (_, index) => ({
      id: `test.action_${index}`, connector: 'test', kind: 'write',
      label: `Action ${index}`, description: `Connected test action ${index}`,
      sideEffect: 'EXTERNAL', params: [],
    }));
    registerDynamicCapabilities(capabilities);
    const requests: Array<{
      state: unknown;
      questions: Record<string, { type: string; criteria?: Record<string, unknown> }>;
    }> = [];
    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
      const request = JSON.parse(String(init?.body)) as (typeof requests)[number];
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

      for (const [questionId, question] of Object.entries(request.questions)) {
        if (question.type === 'noul') {
          answers[questionId] = { type: 'noul', noul: 0.01 };
        } else if (question.type === 'choice') {
          const choice = Object.hasOwn(question.criteria ?? {}, 'none')
            ? 'none' : Object.keys(question.criteria ?? {})[0]!;
          answers[questionId] = choiceAnswer(choice);
        }
      }
      if (request.questions.route) {
        answers.route = choiceAnswer('execution_enqueue_once');
      }
      if (request.questions.explicit_execution_now) answers.explicit_execution_now = choiceAnswer('execute_now');
      if (request.questions.action_scope) answers.action_scope = choiceAnswer('single_action');
      for (const [questionId, question] of Object.entries(request.questions)) {
        if (questionId.startsWith('action_group_') && question.type === 'choice') {
          const target = questionId.endsWith('_0') ? 'test.action_0' : 'test.action_259';
          answers[questionId] = choiceAnswer(choiceForCapability(question, target));
        } else if (questionId.startsWith('action_tournament_') && question.type === 'choice') {
          answers[questionId] = choiceAnswer(choiceForCapability(question, 'test.action_259'));
        }
      }

      return new Response(JSON.stringify({ model: 'jev-latest', answers }), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    });

    try {
      const reply = await runAxCommandChat({
        harness: new AgentHarness(scriptedModel([], [], 'test-provider', [], textSeen)),
        commandService: service,
        decisionEngine: new JevDecisionEngine({ apiKey: 'test-key', fetch: fetchImpl }),
        connectedConnectors: ['test'],
        messages: [],
        userMessage: '다음 작업을 지금 실행해줘.',
      });
      expect(reply).toContain('큐');
      expect(fetchImpl).toHaveBeenCalledTimes(requests.length);
      expect(requests).toHaveLength(3);
      expect(Object.keys(requests[0]!.questions)).toEqual(['route', 'explicit_execution_now', 'action_scope']);
      expect(Object.keys(requests[1]!.questions)).toEqual(['action_group_0', 'action_group_1']);
      expect(Object.keys(requests[2]!.questions)).toEqual(['action_tournament_0_group_0']);
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
      const offeredIds = actionGroups.flatMap(([, question]) => question.type === 'choice'
        ? Object.values(question.criteria).flatMap((value) => typeof value === 'string' && value.includes(' — ')
          ? [value.split(' — ', 1)[0]!] : [])
        : []);
      expect(offeredIds).toHaveLength(capabilities.length);
      expect(new Set(offeredIds).size).toBe(capabilities.length);
      expect(execute).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'execution.enqueue_once',
          args: expect.objectContaining({
            steps: [expect.objectContaining({
              connector: 'test', action: 'action_259', actionRef: expect.any(String),
            })],
          }),
        }),
        expect.objectContaining({ executionContext: { origin: 'agent' } }),
      );
      expect(textSeen).toHaveLength(0);
      expect(appendAppLog).toHaveBeenCalledWith('info', 'Jev chat route timing recorded.', expect.objectContaining({
        jevSelectedRoute: 'execution_enqueue_once',
        jevRouteConfidence: 0.99,
        jevActionScopeChoice: 'single_action',
        jevActionScopeConfidence: 0.99,
        jevActionCandidateSelected: true,
        jevActionCandidateConfidence: 0.99,
        jevActionCandidateCount: capabilities.length,
        jevActionCatalogSize: capabilities.length,
        jevEvaluationCalls: 3,
        jevProviderRequestCount: 3,
        jevEstimatedRequestBytes: expect.any(Number),
      }));
    } finally {
      clearDynamicCatalogForTests();
      db.close();
    }
  });

  it('routes a lower-confidence external write to runtime approval before executing it', async () => {
    const db = await createDatabaseAsync(':memory:');
    try {
      const store = new WorkflowStore(db);
      store.setConnection('gmail', true, { email: 'primary' });
      const connectors = createTestConnectors();
      const gmail = mockGmail(connectors);
      const runtime = new WorkflowRuntime({
        store,
        globalActive: true,
        workflowActive: {},
        connectors,
      });
      const service = new AxCommandService(store, {
        enqueueOnce: (workflow, options) => runtime.enqueueEphemeralWorkflow(workflow, {
          triggerType: 'manual',
          workspaceSessionId: options?.workspaceSessionId,
        }),
      });
      const decisionEngine: DecisionEngine = {
        evaluate: async (request) => {
          const action = request.questions.action;
          const selected = action?.type === 'choice'
            ? Object.entries(action.criteria).find(([, criterion]) =>
                matchesAction(criterion, 'gmail', 'message.send'))
            : undefined;
          if (!selected) {
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
            } };
          }
          return {
            answers: {
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
                type: 'choice', choice: selected[0],
                probabilities: { [selected[0]]: 0.84, none: 0.16 }, confidence: 0.83,
              },
            },
          };
        },
      };
      const textSeen: TextGenerateInput[] = [];
      const reply = await runAxCommandChat({
        harness: new AgentHarness(scriptedModel([], [], 'test-provider', [], textSeen)),
        commandService: service,
        decisionEngine,
        connectedConnectors: ['gmail'],
        workspaceSessionId: 'chat-approval-test',
        messages: [],
        userMessage: '이번만 person@example.com에게 메일을 보내줘. 일회성으로 실행해줘. body: "견적서를 보내 주세요"',
      });

      expect(reply).toContain('큐');
      await runtime.waitForIdle();
      const [approval] = store.getPendingApprovals();
      expect(approval).toBeDefined();
      expect(store.listWorkflows()).toHaveLength(0);
      expect(store.getExecution(approval!.executionId)).toMatchObject({
        ephemeral: true,
        status: 'pending_approval',
      });
      expect(gmail.sent).toEqual([]);
      expect(textSeen).toHaveLength(0);

      const result = await runtime.continueAfterApproval(approval!.id);
      expect(result.status).toBe('success');
      expect(gmail.sent).toEqual([{ to: 'person@example.com', body: '견적서를 보내 주세요' }]);
      await runtime.waitForIdle();
    } finally {
      db.close();
    }
  });

  it('uses the text model directly when Jev selects a conversational answer', async () => {
    const db = await createDatabaseAsync(':memory:');
    const service = new AxCommandService(new WorkflowStore(db));
    const execute = vi.spyOn(service, 'execute');
    const seen: StructuredGenerateInput<unknown>[] = [];
    const textSeen: TextGenerateInput[] = [];
    const decisionEngine: DecisionEngine = {
      evaluate: async () => ({
        answers: {
          route: {
            type: 'choice',
            choice: 'answer',
            probabilities: { answer: 0.97 },
            confidence: 0.97,
          },
          explicit_workflow_run: { type: 'boolean', probability: 0.01 },
        },
      }),
    };
    const harness = new AgentHarness(scriptedModel([], seen, 'test-provider', [
      'workflow는 저장된 업무이고 일회 실행은 저장하지 않는 한 번의 실행입니다.',
    ], textSeen));

    await expect(runAxCommandChat({
      harness,
      commandService: service,
      decisionEngine,
      messages: [],
      userMessage: 'workflow와 일회 실행의 차이를 설명해줘',
    })).resolves.toContain('저장된 업무');
    expect(seen).toHaveLength(0);
    expect(textSeen).toHaveLength(1);
    expect(execute).not.toHaveBeenCalled();
  });

  it('uses Jev to classify casual text before the LLM writes the reply', async () => {
    vi.mocked(appendAppLog).mockClear();
    const db = await createDatabaseAsync(':memory:');
    const service = new AxCommandService(new WorkflowStore(db));
    const seen: StructuredGenerateInput<unknown>[] = [];
    const textSeen: TextGenerateInput[] = [];
    let evaluations = 0;
    const decisionEngine: DecisionEngine = {
      evaluate: async () => {
        evaluations += 1;
        return {
          answers: {
            route: { type: 'choice', choice: 'answer', probabilities: { answer: 0.98 }, confidence: 0.98 },
            explicit_workflow_run: { type: 'boolean', probability: 0.01 },
          },
        };
      },
    };
    const harness = new AgentHarness(scriptedModel([], seen, 'test-provider', ['알겠어요.'], textSeen));

    await expect(runAxCommandChat({
      harness,
      commandService: service,
      decisionEngine,
      messages: [],
      userMessage: '바보',
    })).resolves.toBe('알겠어요.');
    expect(evaluations).toBe(1);
    expect(seen).toHaveLength(0);
    expect(textSeen).toHaveLength(1);
  });

  it('uses Jev to classify a conceptual API question before the LLM answers', async () => {
    const db = await createDatabaseAsync(':memory:');
    const service = new AxCommandService(new WorkflowStore(db));
    const textSeen: TextGenerateInput[] = [];
    let evaluations = 0;
    const decisionEngine: DecisionEngine = {
      evaluate: async () => {
        evaluations += 1;
        return {
          answers: {
            route: { type: 'choice', choice: 'answer', probabilities: { answer: 0.99 }, confidence: 0.99 },
            explicit_workflow_run: { type: 'boolean', probability: 0.01 },
          },
        };
      },
    };
    const harness = new AgentHarness(scriptedModel([], [], 'test-provider', ['API는 외부 서비스와 통신하는 인터페이스입니다.'], textSeen));

    await expect(runAxCommandChat({
      harness,
      commandService: service,
      decisionEngine,
      messages: [],
      userMessage: 'API가 뭐야?',
    })).resolves.toContain('외부 서비스');
    expect(evaluations).toBe(1);
    expect(textSeen).toHaveLength(1);
  });

  it('uses Jev to classify a conceptual workflow question containing an action noun', async () => {
    const db = await createDatabaseAsync(':memory:');
    const service = new AxCommandService(new WorkflowStore(db));
    const textSeen: TextGenerateInput[] = [];
    let evaluations = 0;
    const decisionEngine: DecisionEngine = {
      evaluate: async () => {
        evaluations += 1;
        return {
          answers: {
            route: { type: 'choice', choice: 'answer', probabilities: { answer: 0.99 }, confidence: 0.99 },
            explicit_workflow_run: { type: 'boolean', probability: 0.01 },
          },
        };
      },
    };
    const harness = new AgentHarness(scriptedModel([], [], 'test-provider', ['저장 workflow는 반복 업무이고 일회 실행은 한 번만 처리합니다.'], textSeen));

    await expect(runAxCommandChat({
      harness,
      commandService: service,
      decisionEngine,
      messages: [],
      userMessage: 'workflow와 일회 실행의 차이를 설명해줘',
    })).resolves.toContain('일회 실행');
    expect(evaluations).toBe(1);
    expect(textSeen).toHaveLength(1);
  });

  it('returns a Jev-selected read failure without an LLM paraphrase', async () => {
    const db = await createDatabaseAsync(':memory:');
    const service = new AxCommandService(new WorkflowStore(db), {
      readGateway: {
        execute: async () => ({ tool: 'sources.list', ok: false, error: 'source_read_failed' }),
      },
    });
    const textSeen: TextGenerateInput[] = [];
    const decisionEngine: DecisionEngine = {
      evaluate: async () => ({ answers: {
        route: {
          type: 'choice',
          choice: 'source_list',
          probabilities: { source_list: 0.98 },
          confidence: 0.98,
        },
      } }),
    };
    const harness = new AgentHarness(scriptedModel([], [], 'test-provider', [], textSeen));

    await expect(runAxCommandChat({
      harness,
      commandService: service,
      decisionEngine,
      messages: [],
      userMessage: '연결된 자료 목록을 보여줘',
    })).resolves.toContain('source_read_failed');
    expect(textSeen).toHaveLength(0);
  });

  it('uses the actual Jev chat flow to project arbitrary requested HTTP fields without an LLM turn', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    store.setConnection('http', true, {
      endpoints: [{ id: 'dummyjson', label: 'DummyJSON', baseUrl: 'https://dummyjson.com/', authType: 'none' }],
    });
    let responseBody = JSON.stringify({ customers: [
      { external_client_ref: 'C-1', subscription_cadence: 'annual', private_note: 'internal-only' },
      { external_client_ref: 'C-2', subscription_cadence: 'monthly', private_note: 'exclude-me' },
    ], total: 2 });
    const response = () => buildHttpResponseArtifact({
      executionId: 'design-tool',
      url: 'https://dummyjson.com/customers?limit=2',
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/json' },
      body: responseBody,
      truncated: false,
    });
    const service = new AxCommandService(store, {
      readGateway: {
        execute: async (request) => {
          expect(request.args).toEqual({
            id: 'http.request',
            params: {
              method: 'GET',
              path: expect.stringMatching(/^customers\?limit=2(?:&select=external_client_ref(?:%2C|,)subscription_cadence)?$/iu),
              connectionId: 'dummyjson',
            },
          });
          return {
            tool: 'capabilities.invoke',
            ok: true,
            data: { capabilityId: 'http.request', data: response(), citations: [], untrusted: true },
          };
        },
      },
    });
    let evaluations = 0;
    const decisionEngine: DecisionEngine = {
      evaluate: async (request) => {
        evaluations += 1;
        if (!request.questions.route) {
          return { answers: Object.fromEntries(Object.keys(request.questions).map((id) => {
            const choice = id === 'display_column_0' || id === 'display_column_1' ? 'include' : 'exclude';
            return [id, {
              type: 'choice' as const,
              choice,
              probabilities: { [choice]: 0.4 },
              confidence: 0.4,
            }];
          })) };
        }
        const requestText = typeof request.state === 'object' && request.state !== null
          && 'request' in request.state && typeof request.state.request === 'string'
          ? request.state.request
          : '';
        const resultStyle = requestText.includes('요약') ? 'summary' : 'data';
        return { answers: {
            route: {
              type: 'choice',
              choice: 'http_read',
              probabilities: { http_read: 0.98, answer: 0.02 },
              confidence: 0.98,
            },
            table_transform: {
              type: 'choice', choice: 'none', probabilities: { none: 0.99 }, confidence: 0.99,
            },
            table_projection: {
              type: 'choice', choice: 'requested_columns',
              probabilities: { requested_columns: 0.99, all_columns: 0.01 }, confidence: 0.99,
            },
            read_result_style: {
              type: 'choice', choice: resultStyle,
              probabilities: { [resultStyle]: 0.99 }, confidence: 0.99,
            },
          } };
      },
    };
    const seen: StructuredGenerateInput<unknown>[] = [];
    const textSeen: TextGenerateInput[] = [];
    const harness = new AgentHarness(scriptedModel([], seen, 'test-provider', ['고객 현황을 요약했습니다.'], textSeen));

    const reply = await runAxCommandChat({
      harness,
      commandService: service,
      decisionEngine,
      connectedConnectors: ['http'],
      httpEndpoints: [
        { id: 'github', label: 'GitHub', usable: true },
        { id: 'dummyjson', label: 'DummyJSON', usable: true },
      ],
      messages: [],
      userMessage: 'DummyJSON에서 GET customers?limit=2 를 조회해서 고객 참조번호와 갱신 주기만 표로 보여줘.',
    });
    expect(reply).toContain('| external_client_ref | subscription_cadence |');
    expect(reply).toContain('| C-2 | monthly |');
    expect(reply).not.toContain('private_note');
    expect(evaluations).toBe(2);
    expect(textSeen).toHaveLength(0);

    responseBody = JSON.stringify({ customer: { external_client_ref: 'C-3' }, private_note: 'raw-secret' });
    const nonTabularReply = await runAxCommandChat({
      harness,
      commandService: service,
      decisionEngine,
      connectedConnectors: ['http'],
      httpEndpoints: [
        { id: 'github', label: 'GitHub', usable: true },
        { id: 'dummyjson', label: 'DummyJSON', usable: true },
      ],
      messages: [],
      userMessage: 'DummyJSON에서 GET customers?limit=2 를 조회해서 고객 참조번호와 갱신 주기만 표로 보여줘.',
    });
    expect(nonTabularReply).toContain('표 형태가 아니어서 요청한 열 선택을 적용할 수 없습니다');
    expect(nonTabularReply).not.toContain('raw-secret');
    expect(evaluations).toBe(3);
    expect(textSeen).toHaveLength(0);

    responseBody = JSON.stringify({ customers: Array.from({ length: 1_000 }, (_, index) => ({
      external_client_ref: `C-${index + 4}`,
      subscription_cadence: index % 2 ? 'monthly' : 'annual',
      private_note: 'do-not-send-to-llm',
    })) });
    const unrelatedHistory = `stale-history-sentinel ${'x'.repeat(20_000)}`;
    const summaryReply = await runAxCommandChat({
      harness,
      commandService: service,
      decisionEngine,
      connectedConnectors: ['http'],
      httpEndpoints: [
        { id: 'github', label: 'GitHub', usable: true },
        { id: 'dummyjson', label: 'DummyJSON', usable: true },
      ],
      messages: [
        { role: 'user', content: unrelatedHistory },
        { role: 'assistant', content: 'stale-history-sentinel: unrelated answer' },
      ],
      userMessage: 'DummyJSON에서 GET customers?limit=2 를 조회해서 고객 참조번호와 갱신 주기만 간단히 요약해줘.',
    });
    expect(summaryReply).toBe('고객 현황을 요약했습니다.');
    expect(textSeen).toHaveLength(1);
    expect(JSON.stringify(textSeen)).not.toContain('do-not-send-to-llm');
    expect(JSON.stringify(textSeen)).not.toContain('stale-history-sentinel');
    expect(JSON.stringify(textSeen)).toContain('DummyJSON에서 GET customers?limit=2');
    const summaryEvidence = textSeen[0]?.messages.find((message) => message.content.startsWith('AX command result'));
    expect(summaryEvidence?.content.length).toBeLessThan(14_000);
    expect(summaryEvidence?.content).toContain('"truncated":true');
    expect(JSON.stringify(textSeen)).toContain('external_client_ref');
    expect(JSON.stringify(textSeen[0]?.messages ?? []).length).toBeLessThan(unrelatedHistory.length);
    expect(evaluations).toBe(5);

    responseBody = JSON.stringify({ customers: [{
      external_client_ref: 'C-99', subscription_cadence: 'annual', private_note: 'must-not-display',
    }] });
    const explicitSelectReply = await runAxCommandChat({
      harness,
      commandService: service,
      decisionEngine,
      connectedConnectors: ['http'],
      httpEndpoints: [
        { id: 'github', label: 'GitHub', usable: true },
        { id: 'dummyjson', label: 'DummyJSON', usable: true },
      ],
      messages: [],
      userMessage: 'DummyJSON에서 GET customers?limit=2&select=external_client_ref,subscription_cadence 를 조회해서 표로 보여줘.',
    });

    expect(explicitSelectReply).toContain('| external_client_ref | subscription_cadence |');
    expect(explicitSelectReply).not.toContain('private_note');
    expect(evaluations).toBe(6);
  });

  it('runs a Jev-selected HTTP read, then locally filters rows without calling the text model', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    store.setConnection('http', true, {
      endpoints: [{ id: 'dummyjson', label: 'DummyJSON', baseUrl: 'https://dummyjson.com/', authType: 'none' }],
    });
    const response = buildHttpResponseArtifact({
      executionId: 'jev-filter',
      url: 'https://dummyjson.com/products?limit=3',
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ products: [
        { title: 'First', stock: 20 },
        { title: 'Second', stock: 50 },
        { title: 'Unknown stock', stock: null },
      ] }),
      truncated: false,
    });
    const service = new AxCommandService(store, {
      readGateway: {
        execute: async (request) => {
          expect(request.args).toMatchObject({
            id: 'http.request',
            params: { method: 'GET', path: 'products?limit=3', connectionId: 'dummyjson' },
          });
          return {
            tool: 'capabilities.invoke',
            ok: true,
            data: { capabilityId: 'http.request', data: response, citations: [], untrusted: true },
          };
        },
      },
    });
    const jevRequests: Parameters<DecisionEngine['evaluate']>[0][] = [];
    const decisionEngine: DecisionEngine = {
      evaluate: async (request) => {
        jevRequests.push(request);
        if (request.questions.route) {
          return { answers: {
            route: { type: 'choice', choice: 'http_read', probabilities: { http_read: 0.98 }, confidence: 0.98 },
            table_transform: { type: 'choice', choice: 'filter', probabilities: { filter: 0.99 }, confidence: 0.99 },
          } };
        }
        const threshold = Object.entries(request.questions.filter_value?.type === 'choice'
          ? request.questions.filter_value.criteria
          : {}).find(([, value]) => Boolean(value && typeof value === 'object'
            && 'value' in value && value.value === 30))?.[0] ?? 'none';
        return { answers: {
          filter_column: { type: 'choice', choice: 'column_1', probabilities: { column_1: 0.99 }, confidence: 0.99 },
          filter_operator: { type: 'choice', choice: 'lte', probabilities: { lte: 0.99 }, confidence: 0.99 },
          filter_value: { type: 'choice', choice: threshold, probabilities: { [threshold]: 0.99 }, confidence: 0.99 },
        } };
      },
    };
    const textSeen: TextGenerateInput[] = [];

    const reply = await runAxCommandChat({
      harness: new AgentHarness(scriptedModel([], [], 'test-provider', [], textSeen)),
      commandService: service,
      decisionEngine,
      requestId: 'chat-http-read-timing',
      connectedConnectors: ['http'],
      httpEndpoints: [{ id: 'dummyjson', label: 'DummyJSON', usable: true }],
      messages: [],
      userMessage: 'DummyJSON에서 GET products?limit=3를 조회하고 재고가 30을 넘지 않은 상품만 남겨 상품명과 재고를 표로 보여줘.',
    });

    expect(reply).toContain('| First | 20 |');
    expect(reply).not.toContain('Second');
    expect(reply).not.toContain('Unknown stock');
    expect(jevRequests).toHaveLength(2);
    expect(jevRequests.some((request) => JSON.stringify(request.state).includes('Unknown stock'))).toBe(false);
    expect(textSeen).toHaveLength(0);
    const executionTiming = vi.mocked(appendAppLog).mock.calls
      .find(([, , extra]) => extra?.event === 'chat_command_execution_timing'
        && extra.requestId === 'chat-http-read-timing'
        && extra.command === 'capability.invoke')?.[2];
    expect(executionTiming).toMatchObject({
      requestId: 'chat-http-read-timing',
      event: 'chat_command_execution_timing',
      command: 'capability.invoke',
      outcome: 'ok',
      durationMs: expect.any(Number),
    });
    expect(executionTiming).not.toHaveProperty('params');
    expect(executionTiming).not.toHaveProperty('userMessage');
    db.close();
  });

  it('records command execution timing when a selected command throws', async () => {
    vi.mocked(appendAppLog).mockClear();
    const db = await createDatabaseAsync(':memory:');
    try {
      const service = new AxCommandService(new WorkflowStore(db));
      vi.spyOn(service, 'execute').mockRejectedValue(new Error('simulated execution failure'));
      const decisionEngine: DecisionEngine = {
        evaluate: async () => ({ answers: {
          route: {
            type: 'choice', choice: 'workflow_list',
            probabilities: { workflow_list: 0.97, answer: 0.03 }, confidence: 0.97,
          },
          explicit_workflow_run: { type: 'boolean', probability: 0.01 },
        } }),
      };

      await expect(runAxCommandChat({
        harness: new AgentHarness(scriptedModel([], [], 'test-provider', [], [])),
        commandService: service,
        decisionEngine,
        requestId: 'chat-command-execution-threw',
        messages: [],
        userMessage: '저장된 workflow 목록을 보여줘',
      })).rejects.toThrow('simulated execution failure');

      const executionTiming = vi.mocked(appendAppLog).mock.calls
        .find(([, , extra]) => extra?.event === 'chat_command_execution_timing'
          && extra.requestId === 'chat-command-execution-threw'
          && extra.command === 'workflow.list')?.[2];
      expect(executionTiming).toMatchObject({
        requestId: 'chat-command-execution-threw',
        event: 'chat_command_execution_timing',
        command: 'workflow.list',
        outcome: 'threw',
        durationMs: expect.any(Number),
      });
      expect(executionTiming).not.toHaveProperty('params');
      expect(executionTiming).not.toHaveProperty('userMessage');
    } finally {
      db.close();
    }
  });

  it('asks for a path instead of sending schema-less endpoint discovery to an LLM', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const service = new AxCommandService(store, {
      readGateway: { execute: async () => { throw new Error('HTTP should not run without a cataloged path'); } },
    });
    const decisionEngine: DecisionEngine = {
      evaluate: async () => ({
        answers: {
          route: {
            type: 'choice', choice: 'http_read',
            probabilities: { http_read: 0.98, answer: 0.02 }, confidence: 0.98,
          },
          table_transform: {
            type: 'choice', choice: 'none', probabilities: { none: 0.99 }, confidence: 0.99,
          },
        },
      }),
    };
    const seen: StructuredGenerateInput<unknown>[] = [];
    const textSeen: TextGenerateInput[] = [];
    const harness = new AgentHarness(scriptedModel([], seen, 'test-provider', [], textSeen));

    await expect(runAxCommandChat({
      harness,
      commandService: service,
      decisionEngine,
      connectedConnectors: ['http'],
      httpEndpoints: [
        { id: 'github', label: 'GitHub', usable: true },
        { id: 'dummyjson', label: 'DummyJSON', usable: true },
      ],
      messages: [],
      userMessage: 'DummyJSON에서 상품 2개만 가져와서 표로 보여줘',
    })).resolves.toContain('사용 설명서');
    expect(seen).toHaveLength(0);
    expect(textSeen).toHaveLength(0);
  });

  it('routes a natural-language HTTP request through Jev and the discovered operation catalog', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    store.setConnection('http', true, { endpoints: [
      {
        id: 'dummyjson', baseUrl: 'https://dummyjson.com/', label: 'DummyJSON', authType: 'none',
        discoveredReadOperations: [{ path: 'products', label: 'Products' }],
      },
      {
        id: 'other', baseUrl: 'https://other.example/', label: 'Other API', authType: 'none',
        discoveredReadOperations: [{ path: 'orders', label: 'Orders' }],
      },
    ] });
    const userMessage = 'DummyJSON에서 가격이 30달러 이하인 상품 5개를 가져와 상품명과 가격을 보여줘';
    const selection = buildJevReadOperationIndex(store.getConnections()).select(userMessage);
    const response = buildHttpResponseArtifact({
      executionId: 'natural-http-read',
      url: 'https://dummyjson.com/products?limit=5',
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ products: [
        { title: 'First', price: 1.99 },
        { title: 'Second', price: 2.99 },
      ] }),
      truncated: false,
    });
    const read = vi.fn(async () => ({
      tool: 'capabilities.invoke',
      ok: true as const,
      data: { capabilityId: 'http.request', data: response, citations: [], untrusted: true },
    }));
    const service = new AxCommandService(store, { readGateway: { execute: read } });
    const jevRequests: Parameters<DecisionEngine['evaluate']>[0][] = [];
    let limitCriteria: Record<string, unknown> | undefined;
    const decisionEngine: DecisionEngine = {
      evaluate: async (request) => {
        jevRequests.push(request);
        if (request.questions.read_parameter_0) {
          const question = request.questions.read_parameter_0;
          limitCriteria = question.type === 'choice' ? question.criteria : undefined;
          return { answers: {
            read_parameter_0: { type: 'choice', choice: 'value_1', probabilities: { value_1: 0.99 }, confidence: 0.99 },
          } };
        }
        if (!request.questions.route) {
          const columnAnswers = Object.fromEntries(Object.entries(request.questions)
            .filter(([key]) => key.startsWith('display_column_'))
            .map(([key]) => [key, {
              type: 'choice' as const,
              choice: 'include',
              probabilities: { include: 0.99 },
              confidence: 0.99,
            }]));
          return { answers: columnAnswers };
        }
        const operation = request.questions.operation;
        if (operation?.type !== 'choice') throw new Error('Expected discovered read operations');
        const productChoice = Object.entries(operation.criteria).find(([key, value]) =>
          key.startsWith('op_') && JSON.stringify(value).includes('DummyJSON: Products'),
        )?.[0];
        if (!productChoice) throw new Error('Products should be a Jev choice');
        return { answers: {
          route: { type: 'choice', choice: 'capability_read', probabilities: { capability_read: 0.99 }, confidence: 0.99 },
          operation: { type: 'choice', choice: productChoice, probabilities: { [productChoice]: 0.99 }, confidence: 0.99 },
          table_transform: { type: 'choice', choice: 'none', probabilities: { none: 0.99 }, confidence: 0.99 },
          table_projection: {
            type: 'choice', choice: 'requested_columns', probabilities: { requested_columns: 0.99 }, confidence: 0.99,
          },
        } };
      },
    };
    const textSeen: TextGenerateInput[] = [];

    const reply = await runAxCommandChat({
      harness: new AgentHarness(scriptedModel([], [], 'test-provider', [], textSeen)),
      commandService: service,
      decisionEngine,
      connectedConnectors: ['http'],
      httpEndpoints: [
        { id: 'dummyjson', label: 'DummyJSON', usable: true },
        { id: 'other', label: 'Other API', usable: true },
      ],
      resolveReadOperationSelection: () => selection,
      messages: [],
      userMessage,
    });

    expect(read).toHaveBeenCalledOnce();
    expect(read.mock.calls[0]?.[0].args).toMatchObject({
      id: 'http.request',
      params: { method: 'GET', path: 'products?limit=5', connectionId: 'dummyjson' },
    });
    expect(reply).toContain('| title | price |');
    expect(reply).toContain('| First | 1.99 |');
    expect(limitCriteria).toMatchObject({ value_0: { value: 30 }, value_1: { value: 5 } });
    expect(jevRequests).toHaveLength(3);
    expect(textSeen).toHaveLength(0);
    db.close();
  });

  it('executes an explicit Jev-selected HTTP path and renders the host response without LLM planning', async () => {
    const db = await createDatabaseAsync(':memory:');
    const response = buildHttpResponseArtifact({
      executionId: 'design-tool',
      url: 'https://dummyjson.com/products?limit=2',
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        products: [
          { title: 'First', price: 1.99 },
          { title: 'Second', price: 2.99 },
        ],
        providerMetadata: 'x'.repeat(5_000),
      }),
      truncated: false,
    });
    const execute = vi.fn(async () => ({ ok: true as const, data: response }));
    const service = new AxCommandService(new WorkflowStore(db));
    const seen: StructuredGenerateInput<unknown>[] = [];
    const textSeen: TextGenerateInput[] = [];
    const decisionEngine: DecisionEngine = {
      evaluate: async () => ({
        answers: {
          route: {
            type: 'choice', choice: 'http_read',
            probabilities: { http_read: 0.98, answer: 0.02 }, confidence: 0.98,
          },
          table_transform: {
            type: 'choice', choice: 'none', probabilities: { none: 0.99 }, confidence: 0.99,
          },
        },
      }),
    };
    const harness = new AgentHarness(scriptedModel([
      { kind: 'command', command: {
        name: 'capability.invoke',
        args: { id: 'http.request', params: { method: 'GET', path: 'products?limit=2', connectionId: 'dummyjson' } },
      } },
    ], seen, 'test-provider', [], textSeen));

    await expect(runAxCommandChat({
      harness,
      commandService: service,
      decisionEngine,
      connectedConnectors: ['http'],
      httpEndpoints: [{ id: 'dummyjson', label: 'DummyJSON', usable: true }],
      messages: [],
      userMessage: 'DummyJSON에서 GET products?limit=2 를 조회해서 표로 보여줘',
      designToolContextFactory: () => buildDesignToolContext([], ['http'], {
        allowUntrustedData: true,
        connectors: { http: { name: 'http', execute } },
      }),
    })).resolves.toContain('| title | price |');

    expect(execute).toHaveBeenCalledTimes(1);
    expect(seen).toHaveLength(0);
    expect(textSeen).toHaveLength(0);
  });

  it('lets Jev interpret a natural-language transform after the user selects an HTTP connection', async () => {
    const db = await createDatabaseAsync(':memory:');
    const response = buildHttpResponseArtifact({
      executionId: 'selected-http-transform',
      url: 'https://dummyjson.com/products?limit=2&select=title,stock',
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ products: [
        { title: 'More stock', stock: 20 },
        { title: 'Less stock', stock: 2 },
      ] }),
      truncated: false,
    });
    const execute = vi.fn(async () => ({ ok: true as const, data: response }));
    const service = new AxCommandService(new WorkflowStore(db));
    const jevRequests: Parameters<DecisionEngine['evaluate']>[0][] = [];
    const decisionEngine: DecisionEngine = {
      evaluate: async (request) => {
        jevRequests.push(request);
        expect(request.questions.table_transform?.type).toBe('choice');
        return { answers: {
          table_transform: { type: 'choice', choice: 'sort', probabilities: { sort: 0.99 }, confidence: 0.99 },
          sort_column: { type: 'choice', choice: 'column_1', probabilities: { column_1: 0.99 }, confidence: 0.99 },
          sort_direction: { type: 'choice', choice: 'asc', probabilities: { asc: 0.99 }, confidence: 0.99 },
        } };
      },
    };
    const textSeen: TextGenerateInput[] = [];
    const originalRequest = 'GET products?limit=2&select=title,stock를 조회해서 재고가 가장 적은 상품부터 상품명과 재고를 보여줘.';
    const selection = httpEndpointSelectionValue('dummyjson');

    const reply = await runAxCommandChat({
      harness: new AgentHarness(scriptedModel([], [], 'test-provider', [], textSeen)),
      commandService: service,
      decisionEngine,
      connectedConnectors: ['http'],
      httpEndpoints: [
        { id: 'dummyjson', label: 'DummyJSON', usable: true },
        { id: 'github', label: 'GitHub', usable: true },
      ],
      messages: [
        { role: 'user', content: originalRequest },
        { role: 'assistant', content: 'HTTP 연결을 선택해 주세요.' },
      ],
      userMessage: selection,
      designToolContextFactory: () => buildDesignToolContext([], ['http'], {
        allowUntrustedData: true,
        connectors: { http: { name: 'http', execute } },
      }),
    });

    expect(execute).toHaveBeenCalledTimes(1);
    expect(jevRequests).toHaveLength(1);
    expect(jevRequests[0]?.state).toMatchObject({ request: originalRequest });
    expect(reply).toContain('Less stock');
    expect(reply.indexOf('Less stock')).toBeLessThan(reply.indexOf('More stock'));
    expect(textSeen).toHaveLength(0);
    db.close();
  });

  it('does not ask for an HTTP connection before Jev classifies an ambiguous request', async () => {
    const db = await createDatabaseAsync(':memory:');
    const service = new AxCommandService(new WorkflowStore(db));
    const execute = vi.spyOn(service, 'execute');
    const seen: StructuredGenerateInput<unknown>[] = [];
    const textSeen: TextGenerateInput[] = [];
    const decisionEngine: DecisionEngine = {
      evaluate: async (request) => ({
        answers: {
          route: {
            type: 'choice', choice: 'http_read',
            probabilities: { http_read: 0.98 }, confidence: 0.98,
          },
          ...(request.questions.http_endpoint?.type === 'choice' ? {
            http_endpoint: {
              type: 'choice', choice: 'http_endpoint_0',
              probabilities: { http_endpoint_0: 0.99 }, confidence: 0.99,
            },
          } : {}),
        },
      }),
    };
    const harness = new AgentHarness(scriptedModel([], seen, 'test-provider', [], textSeen));

    await runAxCommandChat({
      harness,
      commandService: service,
      decisionEngine,
      connectedConnectors: ['http'],
      httpEndpoints: [
        { id: 'products', label: 'Products API', usable: true },
        { id: 'internal', label: '내부 API', usable: true },
      ],
      messages: [],
      userMessage: 'GET /orders 를 조회해줘',
    });
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'capability.invoke',
        args: { id: 'http.request', params: { method: 'GET', path: '/orders', connectionId: 'products' } },
      }),
      expect.anything(),
    );
    expect(seen).toHaveLength(0);
    expect(textSeen).toHaveLength(0);
  });

  it('preserves an explicit HEAD method after the user selects an HTTP connection', async () => {
    const db = await createDatabaseAsync(':memory:');
    const service = new AxCommandService(new WorkflowStore(db));
    const execute = vi.spyOn(service, 'execute');
    const decisionEngine: DecisionEngine = {
      evaluate: async () => { throw new Error('jev_should_not_run'); },
    };

    await runAxCommandChat({
      harness: new AgentHarness(scriptedModel([])),
      commandService: service,
      decisionEngine,
      connectedConnectors: ['http'],
      httpEndpoints: [
        { id: 'products', label: 'Products API', usable: true },
        { id: 'internal', label: 'Internal API', usable: true },
      ],
      messages: [
        { role: 'user', content: 'HEAD /health 를 조회해줘' },
        { role: 'assistant', content: 'HTTP 연결을 선택해 주세요.' },
      ],
      userMessage: 'HTTP 연결 ID: internal',
    });

    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'capability.invoke',
        args: { id: 'http.request', params: { method: 'HEAD', path: '/health', connectionId: 'internal' } },
      }),
      expect.anything(),
    );
    db.close();
  });

  it('never converts an explicit HTTP write method to GET during connection selection', async () => {
    const db = await createDatabaseAsync(':memory:');
    const service = new AxCommandService(new WorkflowStore(db));
    const execute = vi.spyOn(service, 'execute');
    const decisionEngine: DecisionEngine = {
      evaluate: async () => { throw new Error('jev_should_not_execute_http_write'); },
    };

    await runAxCommandChat({
      harness: new AgentHarness(scriptedModel([])),
      commandService: service,
      decisionEngine,
      connectedConnectors: ['http'],
      httpEndpoints: [
        { id: 'orders', label: 'Orders API', usable: true },
        { id: 'internal', label: 'Internal API', usable: true },
      ],
      messages: [
        { role: 'user', content: 'POST path: /orders 를 호출해줘' },
        { role: 'assistant', content: 'HTTP 연결을 선택해 주세요.' },
      ],
      userMessage: 'HTTP 연결 ID: orders',
    });

    expect(execute).not.toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'capability.invoke',
        args: expect.objectContaining({ id: 'http.request' }),
      }),
      expect.anything(),
    );
    db.close();
  });

  it('shows the HTTP connection chooser only after Jev cannot choose a listed endpoint', async () => {
    const db = await createDatabaseAsync(':memory:');
    const service = new AxCommandService(new WorkflowStore(db));
    const execute = vi.spyOn(service, 'execute');
    const seen: StructuredGenerateInput<unknown>[] = [];
    const textSeen: TextGenerateInput[] = [];
    let endpointCriteria: Record<string, unknown> | undefined;
    const decisionEngine: DecisionEngine = {
      evaluate: async (request) => {
        const question = request.questions.http_endpoint;
        endpointCriteria = question?.type === 'choice' ? question.criteria : undefined;
        return { answers: {
          route: {
            type: 'choice', choice: 'http_read',
            probabilities: { http_read: 0.98 }, confidence: 0.98,
          },
          http_endpoint: {
            type: 'choice', choice: 'none', probabilities: { none: 0.98 }, confidence: 0.98,
          },
        } };
      },
    };

    await runAxCommandChat({
      harness: new AgentHarness(scriptedModel([], seen, 'test-provider', [], textSeen)),
      commandService: service,
      decisionEngine,
      connectedConnectors: ['http'],
      httpEndpoints: [
        { id: 'products', label: 'Products API', usable: true },
        { id: 'internal', label: 'Internal API', usable: true },
      ],
      messages: [],
      userMessage: 'GET /orders 를 조회해줘',
    });

    expect(endpointCriteria).toHaveProperty('http_endpoint_0');
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'ui.present', args: expect.objectContaining({ title: '어떤 연결에서 조회할까요?' }) }),
      expect.anything(),
    );
    expect(seen).toHaveLength(0);
    expect(textSeen).toHaveLength(0);
  });

  it('fails closed instead of using an LLM command plan when Jev is unavailable', async () => {
    const db = await createDatabaseAsync(':memory:');
    const service = new AxCommandService(new WorkflowStore(db));
    let evaluations = 0;
    const decisionEngine: DecisionEngine = {
      evaluate: async () => {
        evaluations += 1;
        throw new Error('jev_unavailable');
      },
    };
    const seen: StructuredGenerateInput<unknown>[] = [];
    const textSeen: TextGenerateInput[] = [];
    const harness = new AgentHarness(scriptedModel([], seen, 'test-provider', [], textSeen));

    await expect(runAxCommandChat({
      harness,
      commandService: service,
      decisionEngine,
      messages: [],
      userMessage: 'DummyJSON에 상품을 새로 등록해줘.',
    })).resolves.toContain('의미 판단 서비스를 확인할 수 없어');
    expect(evaluations).toBe(1);
    expect(seen).toHaveLength(0);
    expect(textSeen).toHaveLength(0);
  });

  it('lets the LLM clarify an unsupported Jev route without allowing tool decisions or execution', async () => {
    const db = await createDatabaseAsync(':memory:');
    const service = new AxCommandService(new WorkflowStore(db));
    const execute = vi.spyOn(service, 'execute');
    const seen: StructuredGenerateInput<unknown>[] = [];
    const textSeen: TextGenerateInput[] = [];
    const decisionEngine: DecisionEngine = { evaluate: async () => ({ answers: {} }) };
    const harness = new AgentHarness(scriptedModel(
      [{ kind: 'command', command: { name: 'email.send', args: { to: 'attacker@example.com' } } }],
      seen,
      'test-provider',
      ['실제 메일은 보내지 않았어요. 수신자를 알려 주세요.'],
      textSeen,
    ));

    await expect(runAxCommandChat({
      harness,
      commandService: service,
      decisionEngine,
      messages: [],
      userMessage: '환불 안내 메일을 보내줘',
    })).resolves.toBe('실제 메일은 보내지 않았어요. 수신자를 알려 주세요.');
    expect(textSeen).toHaveLength(1);
    expect(textSeen[0]?.system).toContain('Jev did not select a supported route');
    expect(textSeen[0]?.system).toContain('No AX command or connected-resource operation was executed');
    expect(textSeen[0]?.system).toContain('Do not choose tools');
    expect(textSeen[0]?.system).toContain('otherwise explain that no supported operation was selected');
    expect(seen).toHaveLength(0);
    expect(execute).not.toHaveBeenCalled();
    db.close();
  });

  it('keeps the deterministic unsupported message when LLM reply generation fails', async () => {
    vi.mocked(appendAppLog).mockClear();
    const db = await createDatabaseAsync(':memory:');
    const service = new AxCommandService(new WorkflowStore(db));
    const execute = vi.spyOn(service, 'execute');
    const seen: StructuredGenerateInput<unknown>[] = [];
    const textSeen: TextGenerateInput[] = [];
    const decisionEngine: DecisionEngine = { evaluate: async () => ({ answers: {} }) };
    const harness = new AgentHarness(scriptedModel([], seen, 'test-provider', [], textSeen));

    await expect(runAxCommandChat({
      harness,
      commandService: service,
      decisionEngine,
      messages: [],
      userMessage: '업무 메일을 보내줘',
    })).resolves.toContain('현재 연결된 기능 중 요청에 맞는 작업을 찾지 못했습니다');
    expect(textSeen).toHaveLength(1);
    expect(seen).toHaveLength(0);
    expect(execute).not.toHaveBeenCalled();
    db.close();
  });

  it('explains an oversized current request instead of sending a truncated prompt', async () => {
    const db = await createDatabaseAsync(':memory:');
    const service = new AxCommandService(new WorkflowStore(db));
    const request = 'x'.repeat(64_001);
    const textSeen: TextGenerateInput[] = [];
    const harness = new AgentHarness(scriptedModel([], [], 'test-provider', [], textSeen));

    await expect(runAxCommandChat({
      harness,
      commandService: service,
      messages: [{ role: 'user', content: request }],
      userMessage: request,
    })).resolves.toContain('요청이 너무 길어');
    expect(textSeen).toHaveLength(0);
    db.close();
  });

  it('keeps the LLM conversational when Jev is not configured', async () => {
    const db = await createDatabaseAsync(':memory:');
    const service = new AxCommandService(new WorkflowStore(db));
    const seen: StructuredGenerateInput<unknown>[] = [];
    const textSeen: TextGenerateInput[] = [];
    const harness = new AgentHarness(scriptedModel([
      { kind: 'command', command: { name: 'source.list', args: {} } },
    ], seen, 'test-provider', [], textSeen));

    await expect(runAxCommandChat({
      harness,
      commandService: service,
      messages: [],
      userMessage: '연결된 자료를 검색해줘',
    })).resolves.toContain('Jev');
    expect(seen).toHaveLength(0);
    expect(textSeen).toHaveLength(1);
    expect(textSeen[0]?.system).toContain('No AX command or connected-resource operation was executed');
    db.close();
  });

  it('finishes a Jev-selected catalog read without a second text-model call', async () => {
    const db = await createDatabaseAsync(':memory:');
    const service = new AxCommandService(new WorkflowStore(db), {
      readGateway: {
        execute: async (request) => {
          expect(request.args).toEqual({
            id: 'rdb.query.read',
            params: { table: 'orders', limit: 2 },
          });
          return {
            tool: 'capabilities.invoke',
            ok: true,
            data: {
              capabilityId: 'rdb.query.read',
              data: {
                id: 'orders',
                kind: 'table',
                columns: [{ name: 'id', type: 'integer', nullable: false, inferred: false }],
                rows: [{ index: 0, values: { id: 1 } }],
              },
              citations: [],
              untrusted: true,
            },
          };
        },
      },
    });
    const decisionEngine: DecisionEngine = {
      evaluate: async () => ({
        answers: {
          route: {
            type: 'choice', choice: 'capability_read',
            probabilities: { capability_read: 0.98, answer: 0.02 }, confidence: 0.98,
          },
          operation: {
            type: 'choice', choice: 'op_0',
            probabilities: { op_0: 0.98, none: 0.02 }, confidence: 0.98,
          },
          table_transform: {
            type: 'choice', choice: 'none', probabilities: { none: 0.99 }, confidence: 0.99,
          },
        },
      }),
    };
    const textSeen: TextGenerateInput[] = [];
    const harness = new AgentHarness(scriptedModel([], [], 'test-provider', [], textSeen));

    await expect(runAxCommandChat({
      harness,
      commandService: service,
      decisionEngine,
      connectedConnectors: ['rdb'],
      readOperationHints: [{
        key: 'op_0', capabilityId: 'rdb.query.read', connector: 'rdb',
        label: '주문 조회', description: '허용된 테이블 orders 읽기',
        params: { table: 'orders', limit: 2 },
      }],
      messages: [],
      userMessage: '주문을 표로 보여줘',
    })).resolves.toContain('| id |');
    expect(textSeen).toHaveLength(0);
  });

  it('lets Jev choose another cataloged read after a safe read fails', async () => {
    const db = await createDatabaseAsync(':memory:');
    const requests: Parameters<DecisionEngine['evaluate']>[0][] = [];
    let readCalls = 0;
    const store = new WorkflowStore(db);
    const service = new AxCommandService(store, { readGateway: createDesignToolReadGateway(store) });
    const rdb = {
      name: 'rdb',
      execute: async (_action: string, params: Record<string, unknown>) => {
        readCalls += 1;
        if (readCalls === 1) return {
          ok: false,
          error: 'provider returned private-token=do-not-forward',
          errorCode: 'rdb_error',
          errorDetails: {
            status: 503,
            statusText: 'Service Unavailable',
            body: 'private response body must stay out of Jev context',
            truncated: false,
          },
        };
        return {
          ok: true,
          data: {
            id: params.table,
            kind: 'table',
            columns: [{ name: 'stock', type: 'integer', nullable: false, inferred: false }],
            rows: [{ index: 0, values: { stock: 12 } }],
          },
        };
      },
    };
    const decisionEngine: DecisionEngine = {
      evaluate: async (request) => {
        requests.push(request);
        const operation = request.questions.operation;
        const operationKeys = operation?.type === 'choice'
          ? Object.keys(operation.criteria).filter((key) => key.startsWith('op_'))
          : [];
        if (requests.length === 1) {
          expect(operationKeys).toEqual(['op_0', 'op_1']);
          return { answers: {
            route: { type: 'choice', choice: 'capability_read', probabilities: { capability_read: 0.99 }, confidence: 0.99 },
            operation: { type: 'choice', choice: 'op_0', probabilities: { op_0: 0.99 }, confidence: 0.99 },
            table_transform: { type: 'choice', choice: 'none', probabilities: { none: 0.99 }, confidence: 0.99 },
          } };
        }
        const context = (request.state as { context?: Record<string, unknown> }).context;
        expect(context?.previous_read_failure).toEqual({
          capability_id: 'rdb.query.read',
          status: 'error',
          failure_kind: 'transient',
        });
        expect(operationKeys).toEqual(['op_1']);
        const route = request.questions.route;
        expect(route?.type === 'choice' ? Object.keys(route.criteria) : []).toEqual(['answer', 'capability_read']);
        expect(request.questions).not.toHaveProperty('action');
        expect(request.questions).not.toHaveProperty('explicit_execution_now');
        expect(JSON.stringify(request)).not.toContain('"table":"inventory"');
        expect(JSON.stringify(request)).not.toContain('do-not-forward');
        expect(JSON.stringify(request)).not.toContain('private response body');
        return { answers: {
          route: { type: 'choice', choice: 'capability_read', probabilities: { capability_read: 0.99 }, confidence: 0.99 },
          operation: { type: 'choice', choice: 'op_1', probabilities: { op_1: 0.99 }, confidence: 0.99 },
          table_transform: { type: 'choice', choice: 'none', probabilities: { none: 0.99 }, confidence: 0.99 },
        } };
      },
    };
    const textSeen: TextGenerateInput[] = [];

    await expect(runAxCommandChat({
      harness: new AgentHarness(scriptedModel([], [], 'test-provider', [], textSeen)),
      commandService: service,
      decisionEngine,
      designToolContext: {
        connections: [],
        connectedConnectorIds: ['rdb'],
        allowUntrustedData: true,
        connectors: { rdb },
      },
      connectedConnectors: ['rdb'],
      readOperationHints: [
        { key: 'op_0', capabilityId: 'rdb.query.read', connector: 'rdb', label: '주문 조회', description: '주문 테이블', params: { table: 'orders' } },
        { key: 'op_1', capabilityId: 'rdb.query.read', connector: 'rdb', label: '재고 조회', description: '재고 테이블', params: { table: 'inventory' } },
      ],
      readOperationCatalogSize: 2,
      readOperationSelectionMode: 'full_catalog',
      messages: [],
      userMessage: '재고 현황을 표로 보여줘',
    })).resolves.toContain('| stock |');

    expect(requests).toHaveLength(2);
    expect(readCalls).toBe(2);
    expect(textSeen).toHaveLength(0);
    db.close();
  });

  it.each([
    ['host data policy', 'host_policy'],
    ['permission', 'permission_denied'],
    ['invalid request', 'invalid_request'],
    ['unknown', 'unknown'],
    ['unclassified', undefined],
  ] as const)('does not ask Jev to recover a %s read failure', async (_kind, failureKind) => {
    const db = await createDatabaseAsync(':memory:');
    let evaluations = 0;
    let readCalls = 0;
    const service = new AxCommandService(new WorkflowStore(db), {
      readGateway: {
        execute: async () => {
          readCalls += 1;
          return {
            tool: 'capabilities.invoke',
            ok: false,
            error: 'read_failed',
            failureKind,
          };
        },
      },
    });
    const decisionEngine: DecisionEngine = {
      evaluate: async () => {
        evaluations += 1;
        const operation = evaluations === 1 ? 'op_0' : 'op_1';
        return { answers: {
          route: { type: 'choice', choice: 'capability_read', probabilities: { capability_read: 0.99 }, confidence: 0.99 },
          operation: { type: 'choice', choice: operation, probabilities: { [operation]: 0.99 }, confidence: 0.99 },
        } };
      },
    };
    const textSeen: TextGenerateInput[] = [];

    await runAxCommandChat({
      harness: new AgentHarness(scriptedModel([], [], 'test-provider', [], textSeen)),
      commandService: service,
      decisionEngine,
      connectedConnectors: ['rdb'],
      readOperationHints: [
        { key: 'op_0', capabilityId: 'rdb.query.read', connector: 'rdb', label: '주문 조회', description: '주문 테이블', params: { table: 'orders' } },
        { key: 'op_1', capabilityId: 'rdb.query.read', connector: 'rdb', label: '재고 조회', description: '재고 테이블', params: { table: 'inventory' } },
      ],
      readOperationCatalogSize: 2,
      readOperationSelectionMode: 'full_catalog',
      messages: [],
      userMessage: '주문 내용을 보여줘',
    });

    expect(evaluations).toBe(1);
    expect(readCalls).toBe(1);
    expect(textSeen).toHaveLength(0);
    db.close();
  });

  it('uses Jev to find a semantic match in the full indexed catalog through the chat flow', async () => {
    const db = await createDatabaseAsync(':memory:');
    const selection = buildJevReadOperationIndex([{
      connector: 'rdb',
      connected: true,
      config: { type: 'sqlite', allowedTables: Array.from({ length: 70 }, (_, index) => `table_${index}`) },
    }]).select('재고를 보여줘');
    let offeredOperations: string[] = [];
    const service = new AxCommandService(new WorkflowStore(db), {
      readGateway: {
        execute: async (request) => {
          expect(request.args).toEqual({ id: 'rdb.query.read', params: { table: 'table_69' } });
          return {
            tool: 'capabilities.invoke',
            ok: true,
            data: {
              capabilityId: 'rdb.query.read',
              data: {
                id: 'table_69',
                kind: 'table',
                columns: [{ name: 'stock', type: 'integer', nullable: false, inferred: false }],
                rows: [{ index: 0, values: { stock: 12 } }],
              },
              citations: [],
              untrusted: true,
            },
          };
        },
      },
    });
    const decisionEngine: DecisionEngine = {
      evaluate: async (request) => {
        const operation = request.questions.operation;
        offeredOperations = operation?.type === 'choice'
          ? Object.keys(operation.criteria).filter((key) => key.startsWith('op_'))
          : [];
        return { answers: {
          route: {
            type: 'choice', choice: 'capability_read',
            probabilities: { capability_read: 0.98 }, confidence: 0.98,
          },
          operation: { type: 'choice', choice: 'op_70', probabilities: { op_70: 0.98 }, confidence: 0.98 },
          table_transform: { type: 'choice', choice: 'none', probabilities: { none: 0.99 }, confidence: 0.99 },
        } };
      },
    };
    const textSeen: TextGenerateInput[] = [];
    const harness = new AgentHarness(scriptedModel([], [], 'test-provider', [], textSeen));
    const resolveReadOperationSelection = vi.fn(() => selection);

    await expect(runAxCommandChat({
      harness,
      commandService: service,
      decisionEngine,
      connectedConnectors: ['rdb'],
      resolveReadOperationSelection,
      messages: [],
      userMessage: '재고를 보여줘',
    })).resolves.toContain('"stock": 12');

    expect(selection.mode).toBe('full_catalog');
    expect(offeredOperations).toHaveLength(71);
    expect(resolveReadOperationSelection).toHaveBeenCalledExactlyOnceWith();
    expect(textSeen).toHaveLength(0);
    db.close();
  });

  it('stops safely when Jev detects a data request but a bounded catalog has no local match', async () => {
    const db = await createDatabaseAsync(':memory:');
    const service = new AxCommandService(new WorkflowStore(db));
    const execute = vi.spyOn(service, 'execute');
    const seen: StructuredGenerateInput<unknown>[] = [];
    const textSeen: TextGenerateInput[] = [];
    let evaluations = 0;
    const decisionEngine: DecisionEngine = {
      evaluate: async () => {
        evaluations += 1;
        return {
          answers: {
            route: {
              type: 'choice', choice: 'capability_read',
              probabilities: { capability_read: 0.98, answer: 0.02 }, confidence: 0.98,
            },
            operation: { type: 'choice', choice: 'none', probabilities: { none: 0.99 }, confidence: 0.99 },
          },
        };
      },
    };
    const harness = new AgentHarness(scriptedModel([], seen, 'test-provider', [], textSeen));

    await expect(runAxCommandChat({
      harness,
      commandService: service,
      decisionEngine,
      readOperationHints: Array.from({ length: 64 }, (_, index) => ({
        key: `op_${index}`, capabilityId: `openapi.orders.operation${index}`, connector: 'openapi' as const,
        label: '주문 목록', description: 'GET /orders — 주문 목록', params: {},
      })),
      messages: [],
      userMessage: '재고 상태를 알려줘',
    })).resolves.toContain('요청을 처리할 연결·자료·대상이 부족합니다');
    expect(evaluations).toBe(1);
    expect(execute).not.toHaveBeenCalled();
    expect(seen).toHaveLength(0);
    expect(textSeen).toHaveLength(0);
    db.close();
  });

  it('asks for missing required read parameters instead of letting the LLM guess them', async () => {
    const db = await createDatabaseAsync(':memory:');
    let readCalls = 0;
    const service = new AxCommandService(new WorkflowStore(db), {
      readGateway: {
        execute: async (request) => {
          readCalls += 1;
          expect(request.args).toEqual({
            id: 'openapi.orders.getOrder',
            params: { pathParams: { orderId: 'order-7' } },
          });
          return {
            tool: 'capabilities.invoke',
            ok: true,
            data: {
              capabilityId: 'openapi.orders.getOrder',
              data: {
                id: 'order-detail',
                kind: 'table',
                columns: [{ name: 'id', type: 'string', nullable: false, inferred: false }],
                rows: [{ index: 0, values: { id: 'order-7' } }],
              },
              citations: [],
              untrusted: true,
            },
          };
        },
      },
    });
    const decisionEngine: DecisionEngine = {
      evaluate: async () => ({
        answers: {
          route: {
            type: 'choice', choice: 'capability_read',
            probabilities: { capability_read: 0.98, answer: 0.02 }, confidence: 0.98,
          },
          operation: {
            type: 'choice', choice: 'op_0',
            probabilities: { op_0: 0.98, none: 0.02 }, confidence: 0.98,
          },
        },
      }),
    };
    const seen: StructuredGenerateInput<unknown>[] = [];
    const textSeen: TextGenerateInput[] = [];
    const harness = new AgentHarness(scriptedModel([{
      kind: 'command',
      command: {
        name: 'capability.invoke',
        args: {
          id: 'openapi.orders.getOrder',
          params: { pathParams: { orderId: 'order-7' } },
        },
      },
    }], seen, 'test-provider', [], textSeen));

    await expect(runAxCommandChat({
      harness,
      commandService: service,
      decisionEngine,
      connectedConnectors: ['openapi'],
      readOperationHints: [{
        key: 'op_0', capabilityId: 'openapi.orders.getOrder', connector: 'openapi',
        label: '주문 상세', description: 'GET /orders/{orderId}', params: {},
        parameterHints: [{ path: 'pathParams.orderId', required: true }],
        missingParameterPaths: ['pathParams.orderId'],
      }],
      messages: [],
      userMessage: '주문 상세를 보여줘',
    })).resolves.toContain('orderId');
    expect(readCalls).toBe(0);
    expect(seen).toHaveLength(0);
    expect(textSeen).toHaveLength(0);
  });

  it('does not delegate request decisions to the LLM when Jev is unavailable', async () => {
    const db = await createDatabaseAsync(':memory:');
    const service = new AxCommandService(new WorkflowStore(db));
    const seen: StructuredGenerateInput<unknown>[] = [];
    const textSeen: TextGenerateInput[] = [];
    const decisionEngine: DecisionEngine = {
      evaluate: async () => { throw new Error('jev_unavailable'); },
    };
    const harness = new AgentHarness(scriptedModel([
      { kind: 'command', command: { name: 'workflow.delete', args: { workflowId: 'workflow-1', baseVersion: 1 } } },
    ], seen, 'test-provider', [], textSeen));

    await expect(runAxCommandChat({
      harness,
      commandService: service,
      decisionEngine,
      messages: [],
      userMessage: '상태를 설명해줘',
    })).resolves.toContain('의미 판단 서비스를 확인할 수 없어');
    expect(seen).toHaveLength(0);
    expect(textSeen).toHaveLength(0);
  });

  it('fails closed for schema-less HTTP reads when Jev is unavailable', async () => {
    const db = await createDatabaseAsync(':memory:');
    const service = new AxCommandService(new WorkflowStore(db));
    const seen: StructuredGenerateInput<unknown>[] = [];
    const decisionEngine: DecisionEngine = {
      evaluate: async () => { throw new Error('jev_unavailable'); },
    };
    const harness = new AgentHarness(scriptedModel([
      {
        kind: 'command',
        command: { name: 'capability.invoke', args: { id: 'http.request', params: { method: 'GET', path: 'products' } } },
      },
    ], seen));

    await expect(runAxCommandChat({
      harness,
      commandService: service,
      decisionEngine,
      httpEndpoints: [{ id: 'dummyjson', label: 'DummyJSON', baseUrl: 'https://dummyjson.com/' }],
      messages: [],
      userMessage: 'DummyJSON에서 상품 목록을 조회해줘',
    })).resolves.toContain('의미 판단 서비스를 확인할 수 없어');
    expect(seen).toHaveLength(0);
  });

  it('does not enter the command planner when Jev selects an answer but text generation fails', async () => {
    const db = await createDatabaseAsync(':memory:');
    const service = new AxCommandService(new WorkflowStore(db));
    const execute = vi.spyOn(service, 'execute');
    const seen: StructuredGenerateInput<unknown>[] = [];
    const textSeen: TextGenerateInput[] = [];
    const decisionEngine: DecisionEngine = {
      evaluate: async () => ({
        answers: {
          route: { type: 'choice', choice: 'answer', probabilities: { answer: 0.99 }, confidence: 0.99 },
          explicit_workflow_run: { type: 'boolean', probability: 0.01 },
        },
      }),
    };
    const harness = new AgentHarness(scriptedModel([], seen, 'test-provider', [], textSeen));

    await expect(runAxCommandChat({
      harness,
      commandService: service,
      decisionEngine,
      messages: [],
      userMessage: 'API가 뭐야?',
    })).resolves.toContain('답변을 생성하지 못했습니다');
    expect(textSeen).toHaveLength(1);
    expect(seen).toHaveLength(0);
    expect(execute).not.toHaveBeenCalled();
  });

  it('clarifies unsupported workflow edits without asking the LLM to author a mutation', async () => {
    const db = await createDatabaseAsync(':memory:');
    const service = new AxCommandService(new WorkflowStore(db));
    const execute = vi.spyOn(service, 'execute');
    const seen: StructuredGenerateInput<unknown>[] = [];
    const decisionEngine: DecisionEngine = {
      evaluate: async () => ({
        answers: {
          route: {
            type: 'choice',
            choice: 'workflow_update',
            probabilities: { workflow_update: 0.98, answer: 0.02 },
            confidence: 0.98,
          },
          explicit_workflow_update: { type: 'choice', choice: 'update_now', probabilities: { update_now: 0.99 }, confidence: 0.99 },
          explicit_workflow_step_addition: { type: 'choice', choice: 'do_not_add', probabilities: { do_not_add: 0.99 }, confidence: 0.99 },
          explicit_workflow_run: { type: 'choice', choice: 'do_not_run', probabilities: { do_not_run: 0.99 }, confidence: 0.99 },
        },
      }),
    };
    const harness = new AgentHarness(scriptedModel([
      { kind: 'command', command: { name: 'workflow.delete', args: { workflowId: 'workflow-1', baseVersion: 1 } } },
    ], seen));

    await expect(runAxCommandChat({
      harness,
      commandService: service,
      decisionEngine,
      messages: [],
      userMessage: '현재 workflow를 수정해줘',
      currentWorkflowId: 'workflow-1',
      currentWorkflowVersion: 1,
    })).resolves.toContain('따옴표로 지정한 이름');
    expect(execute).not.toHaveBeenCalled();
    expect(seen).toHaveLength(0);
  });

  it('fails closed when Jev becomes unavailable while planning a saved workflow', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    store.setConnection('gmail', true, { email: 'primary' });
    const workspaceSessionId = store.saveWorkspaceChat({ messages: [] }).id;
    const service = new AxCommandService(store);
    const execute = vi.spyOn(service, 'execute');
    let evaluations = 0;
    const decisionEngine: DecisionEngine = {
      evaluate: async () => {
        evaluations += 1;
        if (evaluations === 1) {
          return {
            answers: {
              route: {
                type: 'choice',
                choice: 'workflow_create',
                probabilities: { workflow_create: 0.99, answer: 0.01 },
                confidence: 0.99,
              },
              explicit_workflow_create: { type: 'choice', choice: 'create_now', probabilities: { create_now: 0.99 }, confidence: 0.99 },
              explicit_workflow_run: { type: 'choice', choice: 'do_not_run', probabilities: { do_not_run: 0.99 }, confidence: 0.99 },
              workflow_trigger: {
                type: 'choice', choice: 'manual',
                probabilities: { manual: 0.99, schedule: 0.01 }, confidence: 0.99,
              },
            },
          };
        }
        throw new Error('jev_unavailable');
      },
    };
    const harness = new AgentHarness(scriptedModel([
      { kind: 'command', command: { name: 'workflow.create', args: { name: '차단된 업무', goal: '생성 요청' } } },
    ], []));

    await expect(runAxCommandChat({
      harness,
      commandService: service,
      decisionEngine,
      connectedConnectors: ['gmail'],
      workspaceSessionId,
      readOperationHints: [{
        key: 'gmail_search', capabilityId: 'gmail.messages.search', connector: 'gmail',
        label: 'Gmail 메일 검색', description: 'Gmail 메일 목록 조회', params: {},
      }],
      messages: [],
      userMessage: '업무를 만들어줘',
    })).resolves.toContain('Jev가 다단계 실행 계획을 판단하지 못해 중단했습니다');
    expect(evaluations).toBe(2);
    expect(execute).not.toHaveBeenCalled();
  });

  it('saves a Jev-compiled manual workflow without an LLM command or reply call', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    store.setConnection('gmail', true, { email: 'primary' });
    const workspaceSessionId = store.saveWorkspaceChat({ messages: [] }).id;
    const service = new AxCommandService(store);
    const execute = vi.spyOn(service, 'execute');
    const seen: StructuredGenerateInput<unknown>[] = [];
    const textSeen: unknown[] = [];
    const commandResults: string[] = [];
    const decisionEngine: DecisionEngine = {
      evaluate: async (request) => {
        if (request.questions.route) {
          return {
            answers: {
              route: {
                type: 'choice' as const, choice: 'workflow_create',
                probabilities: { workflow_create: 0.98, answer: 0.02 }, confidence: 0.98,
              },
              explicit_workflow_create: { type: 'choice' as const, choice: 'create_now', probabilities: { create_now: 0.99 }, confidence: 0.99 },
              workflow_trigger: {
                type: 'choice' as const, choice: 'manual',
                probabilities: { manual: 0.99, schedule: 0.01 }, confidence: 0.99,
              },
            },
          };
        }
        const state = request.state as { planned_steps?: unknown[] };
        if ((state.planned_steps?.length ?? 0) > 0) {
          return {
            answers: {
              next_step: {
                type: 'choice' as const, choice: 'done',
                probabilities: { done: 0.99 }, confidence: 0.99,
              },
            },
          };
        }
        const next = request.questions.next_step;
        if (next?.type !== 'choice') throw new Error('expected Jev workflow planning');
        const selected = Object.entries(next.criteria).find(([, criterion]) =>
          JSON.stringify(criterion).includes('gmail.messages.search'));
        return {
          answers: {
            next_step: {
              type: 'choice' as const, choice: selected?.[0] ?? 'done',
              probabilities: { [selected?.[0] ?? 'done']: 0.99, done: selected ? 0.01 : 0.99 },
              confidence: 0.99,
            },
          },
        };
      },
    };
    const harness = new AgentHarness(scriptedModel([], seen, 'test-provider', [], textSeen));

    const reply = await runAxCommandChat({
      harness,
      commandService: service,
      decisionEngine,
      connectedConnectors: ['gmail'],
      workspaceSessionId,
      readOperationHints: [{
        key: 'gmail_search', capabilityId: 'gmail.messages.search', connector: 'gmail',
        label: 'Gmail 메일 검색', description: 'Gmail 메일 목록 조회', params: {},
      }],
      messages: [],
      userMessage: 'Gmail 메일을 검색하는 수동 workflow를 저장해줘',
      onCommandResult: (result) => commandResults.push(result.command),
    });

    expect(reply).toContain('수동 workflow를 저장했습니다');
    expect(store.listWorkflows()).toHaveLength(1);
    expect(commandResults).toEqual(['workflow.create']);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(seen).toHaveLength(0);
    expect(textSeen).toHaveLength(0);
    db.close();
  });

  it('lets Jev map a quoted workflow subject and host-requests the still-missing body', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    store.setConnection('gmail', true, { email: 'primary' });
    const workspaceSessionId = store.saveWorkspaceChat({ messages: [] }).id;
    const service = new AxCommandService(store);
    const execute = vi.spyOn(service, 'execute');
    const seen: StructuredGenerateInput<unknown>[] = [];
    const textSeen: TextGenerateInput[] = [];
    const commands: AxCommand[] = [];
    const inputRequests: AxInputRequest[] = [];
    const decisionRequests: Parameters<DecisionEngine['evaluate']>[0][] = [];
    let pendingCommand: AxCommand | undefined;
    const decisionEngine: DecisionEngine = {
      evaluate: async (request) => {
        decisionRequests.push(request);
        if (request.questions.route) {
          return { answers: {
            route: {
              type: 'choice', choice: 'workflow_create',
              probabilities: { workflow_create: 0.99, answer: 0.01 }, confidence: 0.99,
            },
            explicit_workflow_create: { type: 'choice', choice: 'create_now', probabilities: { create_now: 0.99 }, confidence: 0.99 },
            workflow_trigger: {
              type: 'choice', choice: 'manual', probabilities: { manual: 0.99 }, confidence: 0.99,
            },
          } };
        }
        const inputQuestion = request.questions.action_input_0;
        if (inputQuestion?.type === 'choice') {
          const subject = Object.entries(inputQuestion.criteria).find(([, criterion]) =>
            typeof criterion === 'object' && criterion !== null
              && 'parameter_name' in criterion && criterion.parameter_name === 'subject',
          )?.[0] ?? 'none';
          return { answers: {
            action_input_0: { type: 'choice', choice: subject, probabilities: { [subject]: 0.99 }, confidence: 0.99 },
          } };
        }
        const state = request.state as { planned_steps?: unknown[] };
        const next = request.questions.next_step;
        if (next?.type !== 'choice') throw new Error('expected Jev workflow planning');
        const selected = (state.planned_steps?.length ?? 0) > 0
          ? ['done', next.criteria.done]
          : Object.entries(next.criteria).find(([, criterion]) =>
              JSON.stringify(criterion).includes('gmail.message.send'),
            );
        const choice = selected?.[0] ?? 'done';
        return { answers: {
          next_step: { type: 'choice', choice, probabilities: { [choice]: 0.99 }, confidence: 0.99 },
        } };
      },
    };

    const harness = new AgentHarness(scriptedModel([], seen, 'test-provider', [], textSeen));
    const reply = await runAxCommandChat({
      harness,
      commandService: service,
      decisionEngine,
      connectedConnectors: ['gmail'],
      workspaceSessionId,
      messages: [],
      userMessage: '이번만 person@example.com에게 "견적서 발송 안내" 제목으로 메일을 보내는 수동 workflow를 저장해줘.',
      onCommandResult: (_result, command) => {
        if (!command) return;
        commands.push(command);
        if (command.name === 'workflow.create') pendingCommand = command;
      },
      onInputRequests: (requests) => inputRequests.push(...requests),
    });

    expect(reply).toContain('필요한 값이 없습니다: body');
    expect(decisionRequests.some((request) => request.questions.action_input_0?.type === 'choice')).toBe(true);
    expect(commands[0]?.args.steps).toMatchObject([{
      action: 'message.send',
      params: { to: 'person@example.com', subject: '견적서 발송 안내' },
    }]);
    expect(commands[0]?.args.steps).not.toMatchObject([{ params: { body: '견적서 발송 안내' } }]);
    expect(inputRequests).toEqual(expect.arrayContaining([expect.objectContaining({ label: '본문', required: true })]));
    expect(store.listWorkflows()).toHaveLength(0);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(seen).toHaveLength(0);
    expect(textSeen).toHaveLength(0);

    if (!pendingCommand) throw new Error('expected host-held workflow command');
    const decisionsBeforeResume = decisionRequests.length;
    const resumedInputRequests: AxInputRequest[] = [];
    const resumedReply = await runAxCommandChat({
      harness,
      commandService: service,
      messages: [],
      workspaceSessionId,
      userMessage: '본문: 견적서를 보내 주세요',
      decisionMessage: '이번만 person@example.com에게 "견적서 발송 안내" 제목으로 메일을 보내는 수동 workflow를 저장해줘.',
      pendingCommand,
      commandInputValues: inputRequests.map((request) => ({
        label: request.label,
        value: '견적서를 보내 주세요',
        ...(request.stepId ? { stepId: request.stepId } : {}),
        ...(request.capabilityId ? { capabilityId: request.capabilityId } : {}),
        ...(request.parameterName ? { parameterName: request.parameterName } : {}),
      })),
      onInputRequests: (requests) => resumedInputRequests.push(...requests),
    });

    expect(resumedReply).toContain('수동 workflow를 저장했습니다');
    expect(decisionRequests).toHaveLength(decisionsBeforeResume);
    expect(resumedInputRequests).toHaveLength(0);
    const savedWorkflows = store.listWorkflows();
    expect(savedWorkflows).toHaveLength(1);
    expect(store.getWorkflow(savedWorkflows[0]!.id)?.steps).toMatchObject([{
      action: 'message.send',
      params: { to: 'person@example.com', subject: '견적서 발송 안내', body: '견적서를 보내 주세요' },
    }]);
    expect(execute).toHaveBeenCalledTimes(2);
    db.close();
  });

  it('deletes only the current workflow version selected by Jev without an LLM call', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const saved = store.saveWorkflow({
      name: '삭제 대상',
      goal: 'Jev deletion path test',
      version: 1,
      inputs: [],
      trigger: { type: 'manual' },
      steps: [],
      permissions: {},
      approval: [],
      allowExternalAuto: false,
      assumptions: [],
      sideEffects: {},
      dataPolicy: {},
    });
    const workflow = store.getWorkflow(saved.workflowId);
    if (!workflow) throw new Error('workflow fixture was not saved');
    const removeWorkflow = vi.fn();
    const service = new AxCommandService(store, { removeWorkflow });
    const execute = vi.spyOn(service, 'execute');
    const structuredCalls: StructuredGenerateInput<unknown>[] = [];
    const textCalls: TextGenerateInput[] = [];
    const commandResults: string[] = [];
    const decisionEngine: DecisionEngine = {
      evaluate: async () => ({
        answers: {
          route: {
            type: 'choice', choice: 'workflow_delete',
            probabilities: { workflow_delete: 0.99, answer: 0.01 }, confidence: 0.99,
          },
          explicit_workflow_delete: { type: 'choice', choice: 'delete_now', probabilities: { delete_now: 0.99 }, confidence: 0.99 },
        },
      }),
    };

    const reply = await runAxCommandChat({
      harness: new AgentHarness(scriptedModel([], structuredCalls, 'test-provider', [], textCalls)),
      commandService: service,
      decisionEngine,
      messages: [],
      currentWorkflowId: saved.workflowId,
      currentWorkflowVersion: workflow.version,
      userMessage: '현재 workflow를 삭제해줘',
      onCommandResult: (result) => commandResults.push(result.command),
    });

    expect(reply).toBe('현재 workflow를 삭제했습니다.');
    expect(commandResults).toEqual(['workflow.delete']);
    expect(execute.mock.calls[0]?.[0]).toMatchObject({
      name: 'workflow.delete',
      args: { workflowId: saved.workflowId, baseVersion: workflow.version },
    });
    expect(removeWorkflow).toHaveBeenCalledExactlyOnceWith(saved.workflowId);
    expect(store.getWorkflow(saved.workflowId)).toBeNull();
    expect(structuredCalls).toHaveLength(0);
    expect(textCalls).toHaveLength(0);
    db.close();
  });

  it('runs the selected workflow from an indirect request after Jev confirms intent', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const saved = store.saveWorkflow({
      name: '대상 업무',
      goal: '실행 라우팅 테스트',
      version: 1,
      inputs: [],
      trigger: { type: 'manual' },
      steps: [],
      permissions: {},
      approval: [],
      allowExternalAuto: false,
      assumptions: [],
      sideEffects: {},
      dataPolicy: {},
    });
    const runWorkflow = vi.fn(async (workflowId: string) => ({ executionId: 'execution-1', workflowId }));
    const service = new AxCommandService(store, { runWorkflow });
    const execute = vi.spyOn(service, 'execute');
    const structuredCalls: StructuredGenerateInput<unknown>[] = [];
    const textCalls: TextGenerateInput[] = [];
    const decisionEngine: DecisionEngine = {
      evaluate: async (request) => {
        expect(request.questions).toHaveProperty('explicit_workflow_run');
        return {
          answers: {
            route: {
              type: 'choice', choice: 'workflow_run',
              probabilities: { workflow_run: 0.99, answer: 0.01 }, confidence: 0.99,
            },
            explicit_workflow_run: { type: 'choice', choice: 'run_now', probabilities: { run_now: 0.99 }, confidence: 0.99 },
          },
        };
      },
    };

    await runAxCommandChat({
      harness: new AgentHarness(scriptedModel([], structuredCalls, 'test-provider', [], textCalls)),
      commandService: service,
      decisionEngine,
      messages: [],
      currentWorkflowId: saved.workflowId,
      userMessage: '아까 정한 업무, 이제 진행하자.',
    });

    expect(execute.mock.calls[0]?.[0]).toEqual({
      name: 'workflow.run', args: { workflowId: saved.workflowId },
    });
    expect(runWorkflow).toHaveBeenCalledExactlyOnceWith(saved.workflowId);
    expect(structuredCalls).toHaveLength(0);
    expect(textCalls).toHaveLength(0);
    db.close();
  });

  it('updates an explicitly quoted workflow name through Jev and the versioned host command', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const saved = store.saveWorkflow({
      name: '기존 이름',
      goal: 'workflow update live-path test',
      version: 1,
      inputs: [],
      trigger: { type: 'manual' },
      steps: [],
      permissions: {},
      approval: [],
      allowExternalAuto: false,
      assumptions: [],
      sideEffects: {},
      dataPolicy: {},
    });
    const workflow = store.getWorkflow(saved.workflowId);
    if (!workflow) throw new Error('workflow fixture was not saved');
    const service = new AxCommandService(store);
    const execute = vi.spyOn(service, 'execute');
    const structuredCalls: StructuredGenerateInput<unknown>[] = [];
    const textCalls: TextGenerateInput[] = [];
    const decisionEngine: DecisionEngine = {
      evaluate: async () => ({
        answers: {
          route: {
            type: 'choice', choice: 'workflow_update',
            probabilities: { workflow_update: 0.99, answer: 0.01 }, confidence: 0.99,
          },
          explicit_workflow_update: { type: 'choice', choice: 'update_now', probabilities: { update_now: 0.99 }, confidence: 0.99 },
          explicit_workflow_step_addition: { type: 'choice', choice: 'do_not_add', probabilities: { do_not_add: 0.99 }, confidence: 0.99 },
        },
      }),
    };

    const reply = await runAxCommandChat({
      harness: new AgentHarness(scriptedModel([], structuredCalls, 'test-provider', [], textCalls)),
      commandService: service,
      decisionEngine,
      messages: [],
      currentWorkflowId: saved.workflowId,
      currentWorkflowVersion: workflow.version,
      userMessage: '현재 workflow 이름을 "주간 재고 요약"으로 바꿔줘',
    });

    expect(reply).toBe('workflow를 수정했습니다.');
    expect(store.getWorkflow(saved.workflowId)).toMatchObject({
      name: '주간 재고 요약',
      version: workflow.version + 1,
    });
    expect(execute).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        name: 'workflow.update',
        args: {
          workflowId: saved.workflowId,
          baseVersion: workflow.version,
          operations: [{ op: 'set', path: 'name', value: '주간 재고 요약' }],
        },
      }),
      expect.anything(),
    );
    expect(structuredCalls).toHaveLength(0);
    expect(textCalls).toHaveLength(0);
    db.close();
  });

  it('removes only the Jev-selected current step and deactivates the edited active workflow', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const setupService = new AxCommandService(store);
    const created = await setupService.execute({
      name: 'workflow.create',
      args: {
        name: '재고 알림',
        goal: '재고 변경을 알린다',
        trigger: { type: 'schedule', schedule: '0 9 * * *', timezone: 'Asia/Seoul' },
        steps: [{
          type: 'action',
          id: 'notify_slack',
          connector: 'slack',
          action: 'send_message',
          params: { channel: '#ax테스트', text: '재고 알림' },
        }],
      },
    }, commandChatContext);
    expect(created.status).toBe('ok');
    const createdData = created.data as { workflowId: string; version: number };
    store.setWorkflowActive(createdData.workflowId, true);
    const workflow = store.getWorkflow(createdData.workflowId);
    if (!workflow) throw new Error('workflow fixture was not saved');

    const service = new AxCommandService(store);
    const execute = vi.spyOn(service, 'execute');
    const structuredCalls: StructuredGenerateInput<unknown>[] = [];
    const textCalls: TextGenerateInput[] = [];
    let evaluations = 0;
    const decisionEngine: DecisionEngine = {
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
        expect(questions.workflow_step_to_remove?.type).toBe('choice');
        expect(questions).not.toHaveProperty('explicit_workflow_step_removal');
        return {
          answers: {
            workflow_step_to_remove: {
              type: 'choice', choice: 'step_0',
              probabilities: { step_0: 0.99, none: 0.01 }, confidence: 0.99,
            },
          },
        };
      },
    };

    const reply = await runAxCommandChat({
      harness: new AgentHarness(scriptedModel([], structuredCalls, 'test-provider', [], textCalls)),
      commandService: service,
      decisionEngine,
      messages: [],
      currentWorkflowId: createdData.workflowId,
      currentWorkflowVersion: workflow.version,
      currentWorkflowSteps: workflow.steps.map((step) => ({
        id: step.id,
        type: step.type,
        label: step.type === 'action' ? `${step.connector} / ${step.action}` : step.type,
      })),
      userMessage: '현재 workflow의 Slack 알림은 더 이상 필요 없어',
    });

    expect(reply).toContain('자동 실행을 중지');
    expect(evaluations).toBe(2);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0]?.[0]).toMatchObject({
      name: 'workflow.update',
      args: {
        workflowId: createdData.workflowId,
        baseVersion: workflow.version,
        operations: [{ op: 'remove_step', stepId: 'notify_slack' }],
      },
    });
    expect(store.getWorkflow(createdData.workflowId)?.steps).toEqual([]);
    expect(store.isWorkflowActive(createdData.workflowId)).toBe(false);
    expect(structuredCalls).toHaveLength(0);
    expect(textCalls).toHaveLength(0);
    db.close();
  });

  it('starts a fresh report when the model echoes an id from an earlier execution result', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ax-report-chat-fresh-'));
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const chat = store.saveWorkspaceChat({ messages: [] });
    const now = new Date().toISOString();
    for (const source of [
      { id: 'template', fileName: 'template.pdf' },
      { id: 'example', fileName: 'example.pdf' },
    ]) {
      store.insertWorkspaceSource({
        ...source, sessionId: chat.id, artifactId: `artifact-${source.id}`,
        mimeType: 'application/pdf', status: 'ready', createdAt: now, updatedAt: now,
      });
    }
    const queued: Array<{ steps: Array<{ params: Record<string, unknown> }> }> = [];
    const service = new AxCommandService(store, {
      workspaceSources: new WorkspaceSourceService(
        store,
        new ArtifactStore(join(root, 'artifacts')),
        join(root, 'sessions'),
      ),
      enqueueOnce: (workflow) => {
        queued.push(workflow as typeof queued[number]);
        return { jobId: 'report-job' };
      },
    });
    const harness = new AgentHarness(scriptedModel([], []));
    const decisionEngine: DecisionEngine = {
      evaluate: async (request) => Object.hasOwn(request.questions, 'intent_match')
        ? {
            answers: {
              intent_match: {
                type: 'choice' as const, choice: 'allow',
                probabilities: { allow: 0.98, clarify: 0.01, reject: 0.01 }, confidence: 0.98,
              },
              explicit_action: { type: 'boolean' as const, probability: 0.98 },
            },
          }
        : {
            answers: {
              route: {
                type: 'choice' as const, choice: 'report_generate',
                probabilities: { report_generate: 0.98, answer: 0.02 }, confidence: 0.98,
              },
              report_source_role_0: {
                type: 'choice' as const, choice: 'template',
                probabilities: { template: 0.98 }, confidence: 0.98,
              },
              report_source_role_1: {
                type: 'choice' as const, choice: 'example',
                probabilities: { example: 0.98 }, confidence: 0.98,
              },
            },
          },
    };

    await runAxCommandChat({
      harness,
      commandService: service,
      decisionEngine,
      workspaceSources: [
        { id: 'template', sessionId: chat.id, artifactId: 'artifact-template', fileName: 'template.pdf', status: 'ready', createdAt: now, updatedAt: now },
        { id: 'example', sessionId: chat.id, artifactId: 'artifact-example', fileName: 'example.pdf', status: 'ready', createdAt: now, updatedAt: now },
      ],
      messages: [{ role: 'assistant', content: '이전 실행 결과: stale-previous-execution' }],
      userMessage: '자료에 있는 양식으로 다음 기간 보고서를 같은 기준과 형식으로 만들어줘',
      workspaceSessionId: chat.id,
    });

    expect(queued).toHaveLength(1);
    expect(queued[0]?.steps[0]?.params).not.toHaveProperty('resumeExecutionId');
  });
});
