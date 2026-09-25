import { describe, expect, it } from 'vitest';
import type { DecisionEngine } from '../../../../contracts/decision.js';
import { createDatabaseAsync } from '../../../../persistence/db.js';
import { WorkflowStore } from '../../../../persistence/workflow-store.js';
import type { WorkflowIR } from '../../../../workflow/schema.js';
import { AgentHarness } from '../../harness.js';
import type { AxCommand, AxInputRequest } from '../schema.js';
import { runAxCommandChat } from '../chat.js';
import { AxCommandService } from '../service.js';
import { scriptedModel } from './fixtures.js';
import { gmailToSlackRecurringDecisionEngine } from './jev-recurring-workflow-fixture.js';

describe('Desktop chat recurring workflow proposal', () => {
  it('plans a typed event workflow with Jev and leaves external targets for host selection', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    store.setConnection('gmail', true, { email: 'primary' });
    store.setConnection('slack', true, {});
    const workspaceSessionId = store.saveWorkspaceChat({ messages: [] }).id;
    const service = new AxCommandService(store, {
      readGateway: {
        execute: async () => ({
          tool: 'capabilities.invoke', ok: true,
          data: { data: { channels: [{ id: 'C_OPERATIONS', name: '운영' }] } },
        }),
      },
    });
    const structuredCalls: unknown[] = [];
    const textCalls: unknown[] = [];
    const proposedCommands: unknown[] = [];
    const decisionEngine = gmailToSlackRecurringDecisionEngine();
    const harness = new AgentHarness(scriptedModel([], structuredCalls, 'test-provider', [], textCalls));
    const presentations: unknown[] = [];

    const reply = await runAxCommandChat({
      harness,
      commandService: service,
      decisionEngine,
      connectedConnectors: ['gmail', 'slack'],
      readOperationHints: [{
        key: 'op_0', capabilityId: 'gmail.messages.read', connector: 'gmail',
        label: '메일 읽기', description: '메일 본문 읽기', params: {},
      }],
      designToolContext: { connections: [], connectedConnectorIds: ['gmail', 'slack'], connectors: {} },
      messages: [],
      workspaceSessionId,
      userMessage: '새 Gmail 메일이 오면 내용을 요약해서 Slack #ax테스트에 알려주는 반복 업무를 제안해줘. 아직 저장하거나 활성화하지 마.',
      onPresentation: (presentation) => presentations.push(presentation),
      onCommandResult: (_result, command) => proposedCommands.push(command),
    });

    expect(reply).toContain('채널을 선택');
    expect(proposedCommands).toMatchObject([{
      name: 'job.propose',
      args: {
        trigger: { type: 'gmail.new_message', accountId: '' },
        steps: [
          { type: 'action', id: 'jev_step_1', action: 'messages.read' },
          { type: 'ai_decision', id: 'jev_step_2', bindings: { sourceText: { from: 'jev_step_1', output: 'body' } } },
          { type: 'action', id: 'jev_step_3', action: 'message.send', bindings: { text: { from: 'jev_step_2', output: 'conclusion' } } },
        ],
        runOnceNow: false,
        allowExternalAuto: false,
      },
    }]);
    expect(presentations).toHaveLength(1);
    expect(JSON.stringify(presentations[0])).toContain('C_OPERATIONS');
    expect(store.listWorkflows()).toHaveLength(0);
    expect(structuredCalls).toHaveLength(0);
    expect(textCalls).toHaveLength(0);
  });

  it('asks for missing fields of a Jev-selected one-shot action without delegating payload generation to the LLM', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    store.setConnection('gmail', true, { email: 'primary' });
    const workspaceSessionId = store.saveWorkspaceChat({ messages: [] }).id;
    const queued: unknown[] = [];
    const service = new AxCommandService(store, {
      enqueueOnce: (workflow) => {
        queued.push(workflow);
        return { jobId: 'should-not-queue-before-input' };
      },
    });
    const structuredCalls: unknown[] = [];
    const textCalls: unknown[] = [];
    const evaluations: string[][] = [];
    const jevStates: string[] = [];
    let sendActionId: string | undefined;
    let jevCalls = 0;
    const actionChoices: unknown[] = [];
    const decisionEngine: DecisionEngine = {
      evaluate: async (request) => {
        jevCalls += 1;
        evaluations.push(Object.keys(request.questions));
        jevStates.push(JSON.stringify(request.state));
        const actionQuestion = request.questions.action;
        const actionCriteria = actionQuestion?.type === 'choice' ? actionQuestion.criteria : {};
        actionChoices.push(actionCriteria);
        const selectedActionId = Object.entries(actionCriteria).find(([, criterion]) =>
          typeof criterion === 'string' && criterion.startsWith('gmail.message.send —'))?.[0];
        if (selectedActionId) sendActionId = selectedActionId;
        return {
          answers: {
            route: {
              type: 'choice', choice: 'execution_enqueue_once',
              probabilities: { execution_enqueue_once: 0.98, answer: 0.02 }, confidence: 0.98,
            },
            explicit_execution_now: { type: 'choice', choice: 'execute_now', probabilities: { execute_now: 0.99 }, confidence: 0.99 },
            action_scope: {
              type: 'choice', choice: 'single_action',
              probabilities: { single_action: 0.99, multi_step: 0.005, unclear: 0.005 }, confidence: 0.99,
            },
            action: {
              type: 'choice', choice: sendActionId ?? 'none',
              probabilities: { [sendActionId ?? 'none']: 0.99, none: 0.01 }, confidence: 0.99,
            },
          },
        };
      },
    };
    const harness = new AgentHarness(scriptedModel([], structuredCalls, 'test-provider', [], textCalls));
    const inputRequests: Array<{ id: string; label: string; type: string; stepId?: string; capabilityId?: string; parameterName?: string }> = [];
    const routedCommands: unknown[] = [];
    let pendingCommand: AxCommand | undefined;

    const reply = await runAxCommandChat({
      harness,
      commandService: service,
      decisionEngine,
      connectedConnectors: ['gmail'],
      messages: [],
      workspaceSessionId,
      userMessage: '이번만 Gmail로 메일을 전달해줘.',
      onInputRequests: (requests) => inputRequests.push(...requests),
      onCommandResult: (_result, command) => {
        routedCommands.push(command);
        if (command?.name === 'execution.enqueue_once') pendingCommand = command;
      },
    });

    expect(evaluations.flat()).toContain('action');
    expect(evaluations.flat()).toContain('action_scope');
    expect(sendActionId, JSON.stringify({ evaluations, actionChoices })).toBeDefined();
    expect(reply).toContain('실행에 필요한 정보를 입력해 주세요');
    expect(routedCommands).toMatchObject([{ name: 'execution.enqueue_once', args: { goal: '이번만 Gmail로 메일을 전달해줘.' } }]);
    expect(inputRequests).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'email', label: '수신자' }),
      expect.objectContaining({ type: 'text', label: '본문' }),
    ]));
    expect(queued).toHaveLength(0);
    expect(store.listWorkflows()).toHaveLength(0);
    expect(structuredCalls).toHaveLength(0);
    expect(textCalls).toHaveLength(0);

    if (!pendingCommand) throw new Error('expected host-held command');
    const callsAfterPlanning = jevCalls;
    const valuesByLabel: Record<string, string> = {
      '수신자': 'person@example.com',
      '본문': '견적서를 보내 주세요',
    };
    const resumedValues = inputRequests.map((request) => ({
      label: request.label,
      value: valuesByLabel[request.label]!,
      ...(request.stepId ? { stepId: request.stepId } : {}),
      ...(request.capabilityId ? { capabilityId: request.capabilityId } : {}),
      ...(request.parameterName ? { parameterName: request.parameterName } : {}),
    }));
    const resumedInputRequests: unknown[] = [];
    await runAxCommandChat({
      harness,
      commandService: service,
      messages: [],
      workspaceSessionId,
      userMessage: '수신자: person@example.com\n본문: 견적서를 보내 주세요',
      decisionMessage: '이번만 Gmail로 메일을 전달해줘.',
      pendingCommand,
      commandInputValues: resumedValues,
      onInputRequests: (requests) => resumedInputRequests.push(...requests),
    });

    expect(jevCalls).toBe(callsAfterPlanning);
    expect(resumedInputRequests).toHaveLength(0);
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({
      steps: [{ connector: 'gmail', action: 'message.send', params: { to: 'person@example.com', body: '견적서를 보내 주세요' } }],
    });
    expect(jevStates.join('\n')).not.toContain('person@example.com');
    expect(jevStates.join('\n')).not.toContain('견적서를 보내 주세요');
    expect(store.listWorkflows()).toHaveLength(0);
    db.close();
  });

  it('resumes the exact host-held one-shot plan without routing or planning again', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    store.setConnection('gmail', true, { email: 'primary' });
    const workspaceSessionId = store.saveWorkspaceChat({ messages: [] }).id;
    const queued: WorkflowIR[] = [];
    const service = new AxCommandService(store, {
      enqueueOnce: (workflow) => {
        queued.push(workflow);
        return { jobId: 'resumed-exact-plan' };
      },
    });
    const structuredCalls: unknown[] = [];
    const textCalls: unknown[] = [];
    let jevCalls = 0;
    const decisionEngine: DecisionEngine = {
      evaluate: async () => {
        jevCalls += 1;
        throw new Error('resuming input must not ask Jev to reconstruct the action plan');
      },
    };
    const pendingCommand = {
      name: 'execution.enqueue_once' as const,
      args: {
        name: '두 안내 메일',
        goal: '두 개의 서로 다른 안내 메일을 각각 보내줘.',
        steps: [
          {
            type: 'action' as const,
            id: 'jev_step_1',
            connector: 'gmail',
            action: 'message.send',
            params: { body: '첫 번째 안내' },
          },
          {
            type: 'action' as const,
            id: 'jev_step_2',
            connector: 'gmail',
            action: 'message.send',
            params: { body: '두 번째 안내' },
          },
        ],
      },
    };
    const executedCommands: unknown[] = [];

    const reply = await runAxCommandChat({
      harness: new AgentHarness(scriptedModel([], structuredCalls, 'test-provider', [], textCalls)),
      commandService: service,
      decisionEngine,
      connectedConnectors: ['gmail'],
      messages: [],
      workspaceSessionId,
      userMessage: '1단계 · 수신자 (1): first@example.com\n2단계 · 수신자 (2): second@example.com',
      pendingCommand,
      commandInputValues: [
        {
          label: '1단계 · 수신자 (1)', value: 'first@example.com',
          stepId: 'jev_step_1', capabilityId: 'gmail.message.send', parameterName: 'to',
        },
        {
          label: '2단계 · 수신자 (2)', value: 'second@example.com',
          stepId: 'jev_step_2', capabilityId: 'gmail.message.send', parameterName: 'to',
        },
      ],
      onCommandResult: (_result, command) => executedCommands.push(command),
    });

    expect(reply).toContain('큐에 등록했습니다');
    expect(jevCalls).toBe(0);
    expect(structuredCalls).toHaveLength(0);
    expect(textCalls).toHaveLength(0);
    expect(executedCommands).toMatchObject([{ name: 'execution.enqueue_once' }]);
    expect(queued).toHaveLength(1);
    expect(queued[0]?.steps).toMatchObject([
      {
        id: 'jev_step_1',
        params: { to: 'first@example.com', body: '첫 번째 안내' },
      },
      {
        id: 'jev_step_2',
        params: { to: 'second@example.com', body: '두 번째 안내' },
      },
    ]);
    db.close();
  });

  it('lets Jev select a typed multi-step one-shot plan without using the LLM command planner', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    store.setConnection('gmail', true, { email: 'primary' });
    const workspaceSessionId = store.saveWorkspaceChat({ messages: [] }).id;
    const queued: Array<{ steps: Array<Record<string, unknown>> }> = [];
    const service = new AxCommandService(store, {
      enqueueOnce: (workflow) => {
        queued.push(workflow as typeof queued[number]);
        return { jobId: 'jev-plan-job' };
      },
    });
    const structuredCalls: unknown[] = [];
    const textCalls: unknown[] = [];
    const jevPayloads: string[] = [];
    const selectedCapabilities = [
      'gmail.messages.search',
      'transform.table_to_text',
      'gmail.draft.create',
    ];
    let selectedIndex = 0;
    const decisionEngine: DecisionEngine = {
      evaluate: async (request) => {
        jevPayloads.push(JSON.stringify({ state: request.state, questions: request.questions }));
        const route = request.questions.route;
        if (route?.type === 'choice') {
          return {
            answers: {
              route: {
                type: 'choice', choice: 'execution_enqueue_once',
                probabilities: { execution_enqueue_once: 0.99, answer: 0.01 }, confidence: 0.99,
              },
              explicit_execution_now: { type: 'choice', choice: 'execute_now', probabilities: { execute_now: 0.99 }, confidence: 0.99 },
              action_scope: {
                type: 'choice', choice: 'multi_step',
                probabilities: { multi_step: 0.99, single_action: 0.005, unclear: 0.005 }, confidence: 0.99,
              },
            },
          };
        }
        if (request.questions.action_scope) {
          return { answers: {
            explicit_execution_now: { type: 'choice', choice: 'execute_now', probabilities: { execute_now: 0.99 }, confidence: 0.99 },
            action_scope: {
              type: 'choice', choice: 'multi_step',
              probabilities: { multi_step: 0.99, single_action: 0.005, unclear: 0.005 }, confidence: 0.99,
            },
          } };
        }

        const nextStep = request.questions.next_step;
        if (nextStep?.type === 'choice') {
          const target = selectedCapabilities[selectedIndex];
          const selected = target && Object.entries(nextStep.criteria).find(([, criterion]) =>
            JSON.stringify(criterion).includes(target));
          if (selected) selectedIndex += 1;
          return {
            answers: {
              next_step: {
                type: 'choice',
                choice: selected?.[0] ?? 'done',
                probabilities: { [selected?.[0] ?? 'done']: 0.99, done: selected ? 0.01 : 0.99 },
                confidence: 0.99,
              },
            },
          };
        }

        const binding = request.questions.input_0;
        if (binding?.type !== 'choice') throw new Error('expected Jev binding choice');
        const source = Object.entries(binding.criteria).find(([, criterion]) =>
          JSON.stringify(criterion).includes('"output":"messages"'));
        return {
          answers: {
            input_0: {
              type: 'choice',
              choice: source?.[0] ?? 'none',
              probabilities: { [source?.[0] ?? 'none']: 0.99, none: source ? 0.01 : 0.99 },
              confidence: 0.99,
            },
          },
        };
      },
    };
    const harness = new AgentHarness(scriptedModel([], structuredCalls, 'test-provider', [], textCalls));
    const inputRequests: AxInputRequest[] = [];
    const plannedCommands: AxCommand[] = [];

    const reply = await runAxCommandChat({
      harness,
      commandService: service,
      decisionEngine,
      connectedConnectors: ['gmail'],
      readOperationHints: [{
        key: 'op_0', capabilityId: 'gmail.messages.search', connector: 'gmail',
        label: 'Gmail 메일 검색', description: 'Gmail 메일 목록 조회', params: {},
      }],
      messages: [],
      workspaceSessionId,
      userMessage: 'Gmail에서 최근 메일을 찾아 표 내용을 텍스트로 바꿔 메일 초안을 만들어줘. 일회성으로 실행해줘.',
      onInputRequests: (requests) => inputRequests.push(...requests),
      onCommandResult: (_result, command) => { if (command) plannedCommands.push(command); },
    });

    expect(reply).toContain('실행에 필요한 정보를 입력해 주세요');
    expect(selectedIndex).toBe(3);
    expect(queued).toHaveLength(0);
    expect(plannedCommands[0]?.args.steps).toMatchObject([
      { id: 'jev_step_1', connector: 'gmail', action: 'messages.search' },
      {
        id: 'jev_step_2', connector: 'transform', action: 'table_to_text',
        bindings: { table: { from: 'jev_step_1', output: 'messages' } },
      },
      {
        id: 'jev_step_3', connector: 'gmail', action: 'draft.create',
        params: {},
        bindings: { body: { from: 'jev_step_2', output: 'text' } },
      },
    ]);
    expect(inputRequests).toContainEqual(expect.objectContaining({
      type: 'email', label: '수신자', stepId: 'jev_step_3', capabilityId: 'gmail.draft.create', parameterName: 'to',
    }));
    expect(structuredCalls).toHaveLength(0);
    expect(textCalls).toHaveLength(0);
    expect(jevPayloads.join('\n')).not.toContain('person@example.com');
    expect(store.listWorkflows()).toHaveLength(0);
    db.close();
  });

  it('fails closed when Jev becomes unavailable during planning', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    store.setConnection('gmail', true, { email: 'primary' });
    const queued: unknown[] = [];
    const service = new AxCommandService(store, {
      enqueueOnce: (workflow) => { queued.push(workflow); return { jobId: 'must-not-queue' }; },
    });
    const structuredCalls: unknown[] = [];
    const textCalls: unknown[] = [];
    let evaluations = 0;
    const decisionEngine: DecisionEngine = {
      evaluate: async (request) => {
        evaluations += 1;
        if (request.questions.route) {
          return {
            answers: {
              route: {
                type: 'choice', choice: 'execution_enqueue_once',
                probabilities: { execution_enqueue_once: 0.99, answer: 0.01 }, confidence: 0.99,
              },
              explicit_execution_now: { type: 'choice', choice: 'execute_now', probabilities: { execute_now: 0.99 }, confidence: 0.99 },
              action_scope: {
                type: 'choice', choice: 'multi_step',
                probabilities: { multi_step: 0.99, single_action: 0.005, unclear: 0.005 }, confidence: 0.99,
              },
            },
          };
        }
        if (request.questions.action_scope) {
          return {
            answers: {
              explicit_execution_now: { type: 'choice', choice: 'execute_now', probabilities: { execute_now: 0.99 }, confidence: 0.99 },
              action_scope: {
                type: 'choice', choice: 'multi_step',
                probabilities: { multi_step: 0.99, single_action: 0.005, unclear: 0.005 }, confidence: 0.99,
              },
            },
          };
        }
        throw new Error('jev_unavailable');
      },
    };

    const reply = await runAxCommandChat({
      harness: new AgentHarness(scriptedModel([], structuredCalls, 'test-provider', [], textCalls)),
      commandService: service,
      decisionEngine,
      connectedConnectors: ['gmail'],
      readOperationHints: [{
        key: 'op_0', capabilityId: 'gmail.messages.search', connector: 'gmail',
        label: 'Gmail 메일 검색', description: 'Gmail 메일 목록 조회', params: {},
      }],
      messages: [],
      userMessage: 'Gmail에서 메일을 검색해서 요약하고 Slack에 공유하는 일회성 업무를 지금 실행해줘. 반복으로 저장하지 마.',
    });

    expect(reply).toContain('Jev가 다단계 실행 계획을 판단하지 못해 중단했습니다');
    expect(evaluations).toBe(2);
    expect(queued).toHaveLength(0);
    expect(structuredCalls).toHaveLength(0);
    expect(textCalls).toHaveLength(0);
    db.close();
  });

  it('lets Jev compile a manual workflow without an LLM command call', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    store.setConnection('gmail', true, { email: 'primary' });
    const workspaceSessionId = store.saveWorkspaceChat({ messages: [] }).id;
    const service = new AxCommandService(store);
    const structuredCalls: unknown[] = [];
    const textCalls: unknown[] = [];
    let selectedRead = false;
    const decisionEngine: DecisionEngine = {
      evaluate: async (request) => {
        if (request.questions.route) {
          return {
            answers: {
              route: {
                type: 'choice', choice: 'workflow_create',
                probabilities: { workflow_create: 0.99, answer: 0.01 }, confidence: 0.99,
              },
              explicit_workflow_run: { type: 'choice', choice: 'do_not_run', probabilities: { do_not_run: 0.99 }, confidence: 0.99 },
              explicit_workflow_create: { type: 'choice', choice: 'create_now', probabilities: { create_now: 0.99 }, confidence: 0.99 },
              workflow_trigger: {
                type: 'choice', choice: 'manual',
                probabilities: { manual: 0.99, schedule: 0.01 }, confidence: 0.99,
              },
            },
          };
        }
        const next = request.questions.next_step;
        if (next?.type !== 'choice') throw new Error('expected Jev plan selection');
        if (!selectedRead) {
          const selected = Object.entries(next.criteria).find(([, criterion]) =>
            JSON.stringify(criterion).includes('gmail.messages.search'));
          if (!selected) throw new Error('Gmail search must be a selectable capability');
          selectedRead = true;
          return {
            answers: {
              next_step: {
                type: 'choice', choice: selected[0],
                probabilities: { [selected[0]]: 0.99, done: 0.01 }, confidence: 0.99,
              },
            },
          };
        }
        return {
          answers: {
            next_step: {
              type: 'choice', choice: 'done',
              probabilities: { done: 0.99 }, confidence: 0.99,
            },
          },
        };
      },
    };

    const reply = await runAxCommandChat({
      harness: new AgentHarness(scriptedModel([], structuredCalls, 'test-provider', [], textCalls)),
      commandService: service,
      decisionEngine,
      connectedConnectors: ['gmail'],
      workspaceSessionId,
      readOperationHints: [{
        key: 'op_0', capabilityId: 'gmail.messages.search', connector: 'gmail',
        label: 'Gmail 메일 검색', description: 'Gmail 메일 목록 조회', params: {},
      }],
      messages: [],
      userMessage: 'Gmail에서 최근 메일을 찾는 수동 workflow를 만들어줘.',
    });

    expect(reply).toContain('저장');
    const savedWorkflows = store.listWorkflows();
    expect(savedWorkflows).toHaveLength(1);
    const savedWorkflow = savedWorkflows[0] && store.getWorkflow(savedWorkflows[0].id);
    expect(savedWorkflow?.trigger).toMatchObject({ type: 'manual' });
    expect(savedWorkflow?.steps).toMatchObject([
      { connector: 'gmail', action: 'messages.search' },
    ]);
    expect(structuredCalls).toHaveLength(0);
    expect(textCalls).toHaveLength(0);
    db.close();
  });
});
