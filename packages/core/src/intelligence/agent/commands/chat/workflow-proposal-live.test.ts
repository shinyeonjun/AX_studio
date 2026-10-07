import { describe, expect, it } from 'vitest';
import type { DecisionEngine, DecisionEvaluationResult } from '../../../../contracts/decision.js';
import { createDatabaseAsync } from '../../../../persistence/db.js';
import { WorkflowStore } from '../../../../persistence/workflow-store.js';
import type { WorkflowIR } from '../../../../workflow/schema.js';
import { AgentHarness } from '../../harness.js';
import type { StructuredGenerateInput, TextGenerateInput } from '../../model/provider.js';
import type { AxCommand } from '../schema.js';
import { runAxCommandChat } from '../chat.js';
import { AxCommandService } from '../service.js';
import { parallelToolAnswersForTest, parallelToolQuestionIdForTest, scriptedModel } from './fixtures.js';

describe('Desktop chat recurring workflow proposal', () => {
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
    const structuredCalls: StructuredGenerateInput<unknown>[] = [];
    const textCalls: TextGenerateInput[] = [];
    const evaluations: string[][] = [];
    const jevStates: string[] = [];
    let sendActionId: string | undefined;
    let jevCalls = 0;
    const decisionEngine: DecisionEngine = {
      evaluate: async (request): Promise<DecisionEvaluationResult> => {
        jevCalls += 1;
        evaluations.push(Object.keys(request.questions));
        jevStates.push(JSON.stringify(request.state));
        const selectedActionId = parallelToolQuestionIdForTest(request, (candidate) =>
          candidate.capabilityId === 'gmail.message.send');
        if (selectedActionId) sendActionId = selectedActionId;
        return {
          answers: {
            ...parallelToolAnswersForTest(request, {
              needsNaturalLanguageAnswer: false,
              select: (candidate) => candidate.capabilityId === 'gmail.message.send',
            }),
            route: {
              type: 'choice', choice: 'execution_enqueue_once',
              probabilities: { execution_enqueue_once: 0.98, answer: 0.02 }, confidence: 0.98,
            },
            explicit_execution_now: { type: 'choice', choice: 'execute_now', probabilities: { execute_now: 0.99 }, confidence: 0.99 },
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

    expect(evaluations.flat()).toContain('needs_natural_language_answer');
    expect(sendActionId).toMatch(/^tool_\d+$/u);
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
    db.close?.();
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
    const structuredCalls: StructuredGenerateInput<unknown>[] = [];
    const textCalls: TextGenerateInput[] = [];
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

    expect(reply).toContain('작업을 시작했습니다');
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
    db.close?.();
  });

  it('lets Jev compile a manual workflow without an LLM command call', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    store.setConnection('gmail', true, { email: 'primary' });
    const workspaceSessionId = store.saveWorkspaceChat({ messages: [] }).id;
    const service = new AxCommandService(store);
    const structuredCalls: StructuredGenerateInput<unknown>[] = [];
    const textCalls: TextGenerateInput[] = [];
    let selectedRead = false;
    const decisionEngine: DecisionEngine = {
      evaluate: async (request): Promise<DecisionEvaluationResult> => {
        if (request.questions.requirements) return { answers: parallelToolAnswersForTest(request, { needsNaturalLanguageAnswer: false }) };
        if (request.questions.route) {
          return {
            answers: {
              ...parallelToolAnswersForTest(request, {
                needsNaturalLanguageAnswer: false,
                select: (candidate) => candidate.id === 'read:op_0',
              }),
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
    db.close?.();
  });
});
