import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AxCommandService,
  createDatabaseAsync,
  JevDecisionEngine,
  MAX_DECISION_CHOICE_CRITERIA,
  MockMcpClient,
  WorkflowStore,
  ingestOpenApiSpec,
  ingestMcpServer,
  type AxInputRequest,
  type McpToolDefinition,
  type WorkflowIR,
} from '@ax-studio/core';
import * as axCore from '@ax-studio/core';
import { claimPendingCommand, clearPendingCommand } from './pending-command.js';
import { commandInputContinuation } from '../chat-boundary.js';

function actionCriterionId(value: unknown): string | undefined {
  if (typeof value === 'string') return value.split(' — ', 1)[0]?.trim() || undefined;
  if (typeof value !== 'object' || value === null) return undefined;
  const criterion = value as Record<string, unknown>;
  return typeof criterion.connector === 'string' && typeof criterion.action === 'string'
    ? `${criterion.connector}.${criterion.action}`
    : undefined;
}

const ipcMocks = vi.hoisted(() => {
  const mainFrame = { url: 'app://index' };
  return {
    app: { isPackaged: true },
    ipcMain: { removeHandler: vi.fn(), handle: vi.fn() },
    mainFrame,
    mainWindow: {
      isDestroyed: () => false,
      webContents: { id: 42, mainFrame },
    },
    getCore: vi.fn(),
  };
});

vi.mock('electron', () => ({ app: ipcMocks.app, ipcMain: ipcMocks.ipcMain }));
vi.mock('../../app-window.js', () => ({
  getMainWindow: () => ipcMocks.mainWindow,
  isTrustedRendererUrl: (url: string) => url === 'app://index',
}));
vi.mock('../../core-instance.js', () => ({ getCore: ipcMocks.getCore }));
vi.mock('../design-tool-context.js', () => ({ buildDesktopDesignToolContext: () => ({}) }));
vi.mock('../../e2e-test-seam.js', () => ({ runE2EChat: vi.fn() }));

import { registerWorkspaceChatMessageHandler } from './chat.js';

describe('Desktop workspace chat Jev routing', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('routes IPC chat through Jev and caches read operations by connection revision', async () => {
    const events: string[] = [];
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      events.push('jev');
      const request = JSON.parse(String(init?.body)) as {
        questions: Record<string, { type: 'noul' | 'choice' | 'score'; criteria?: Record<string, unknown> }>;
      };
      const answers = Object.fromEntries(Object.entries(request.questions).map(([id, question]) => {
        if (question.type === 'noul') return [id, { type: 'noul', noul: 0.01 }];
        if (question.type === 'choice') {
          const choices = Object.keys(question.criteria ?? {});
          const selected = id === 'route' ? 'answer' : choices.includes('none') ? 'none' : choices[0]!;
          return [id, {
            type: 'choice',
            choice: selected,
            probabilities: Object.fromEntries(choices.map(choice => [choice, choice === selected ? 0.99 : 0.01])),
            confidence: 0.99,
          }];
        }
        return [id, { type: 'score', score: 0, probabilities: {} }];
      }));
      return new Response(JSON.stringify({ model: 'test-jev', answers }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    const decisionEngine = new JevDecisionEngine({ apiKey: 'test-key', fetch: fetchImpl });
    const agentHarness = {
      providerName: 'test-llm',
      runText: vi.fn(async () => {
        events.push('llm');
        return { output: '안녕하세요.', provider: 'test-llm', durationMs: 1, promptChars: 1 };
      }),
    };
    const commandService = { execute: vi.fn(async () => { throw new Error('unexpected command'); }) };
    let connectionRevision = 0;
    const store = {
      getWorkspaceChat: vi.fn(() => ({
        id: 'session-1',
        messages: [{ role: 'user', content: '안녕' }],
      })),
      getConnections: vi.fn(() => []),
      getConnectionRevision: () => connectionRevision,
      getWorkspaceChatMemo: vi.fn(() => ({})),
      getWorkflowPolicy: vi.fn(() => ({})),
    };
    const core = {
      store,
      workspaceSources: { list: vi.fn(() => []) },
      decisionEngine,
      agentHarness,
      commandService,
    };
    ipcMocks.getCore.mockReturnValue(core);

    registerWorkspaceChatMessageHandler();
    const handler = ipcMocks.ipcMain.handle.mock.calls.at(-1)?.[1] as (
      event: unknown,
      message: string,
      requestId: string,
      workflowId: undefined,
      sessionId: string,
    ) => Promise<{ role: string; content: string }>;
    const event = {
      sender: { id: 42, mainFrame: ipcMocks.mainFrame, send: vi.fn() },
      senderFrame: ipcMocks.mainFrame,
    };

    const indexSpy = vi.spyOn(axCore, 'buildJevReadOperationIndex');
    const reply = await handler(event, '안녕', 'request-1', undefined, 'session-1');
    const cachedReply = await handler(event, '안녕', 'request-2', undefined, 'session-1');
    connectionRevision++;
    const refreshedReply = await handler(event, '안녕', 'request-3', undefined, 'session-1');

    expect(reply).toMatchObject({ role: 'assistant', content: '안녕하세요.' });
    expect(cachedReply).toMatchObject({ role: 'assistant', content: '안녕하세요.' });
    expect(refreshedReply).toMatchObject({ role: 'assistant', content: '안녕하세요.' });
    expect(events).toEqual(['jev', 'llm', 'jev', 'llm', 'jev', 'llm']);
    expect(indexSpy).toHaveBeenCalledTimes(2);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(commandService.execute).not.toHaveBeenCalled();
  });

  it('uses Jev to select a connected write action and asks for missing required input before queueing', async () => {
    const requestMessage = '이번만 person@example.com에게 제목은 견적서 발송 안내; 지금 메일을 보내줘. 일회성으로 실행해줘.';
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    store.setConnection('gmail', true, { email: 'primary' });
    const chat = store.saveWorkspaceChat({ messages: [{ role: 'user', content: requestMessage }] });
    const queued = vi.fn((_workflow: WorkflowIR) => ({ jobId: 'must-not-queue' }));
    const commandService = new AxCommandService(store, { enqueueOnce: queued });
    const execute = vi.spyOn(commandService, 'execute');
    const requests: Array<{ questions: Record<string, { type: string; criteria?: Record<string, unknown> }> }> = [];
    const matchingChoice = (entries: Array<[string, unknown]>, field: string, value: string): string =>
      entries.find(([, criterion]) => typeof criterion === 'object' && criterion !== null
        && field in criterion && (criterion as Record<string, unknown>)[field] === value)?.[0] ?? 'none';
    const selectedChoice = (id: string, entries: Array<[string, unknown]>): string => {
      if (id === 'route') return 'execution_enqueue_once';
      if (id === 'explicit_execution_now') return 'execute_now';
      if (id === 'action_scope') return 'single_action';
      if (id.startsWith('action_input_')) return matchingChoice(entries, 'parameter_name', 'subject');
      if (id === 'action' || id.startsWith('action_group_')) {
        return entries.find(([, criterion]) => actionCriterionId(criterion) === 'gmail.message.send')?.[0] ?? 'none';
      }
      return entries.some(([key]) => key === 'none') ? 'none' : entries[0]?.[0] ?? 'none';
    };
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      const request = JSON.parse(String(init?.body)) as (typeof requests)[number];
      requests.push(request);
      const answers = Object.fromEntries(Object.entries(request.questions).map(([id, question]) => {
        if (question.type === 'noul') return [id, { type: 'noul', noul: 0.01 }];
        if (question.type === 'choice') {
          const entries = Object.entries(question.criteria ?? {});
          const selected = selectedChoice(id, entries);
          return [id, {
            type: 'choice', choice: selected,
            probabilities: { [selected]: 0.99 }, confidence: 0.99,
          }];
        }
        return [id, { type: 'score', score: 0, probabilities: {} }];
      }));
      return new Response(JSON.stringify({ model: 'test-jev', answers }), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    });
    const decisionEngine = new JevDecisionEngine({ apiKey: 'test-key', fetch: fetchImpl });
    const agentHarness = {
      providerName: 'test-llm',
      runText: vi.fn(async () => { throw new Error('LLM must not choose or execute this action'); }),
    };
    ipcMocks.getCore.mockReturnValue({
      store,
      workspaceSources: { list: vi.fn(() => []) },
      decisionEngine,
      agentHarness,
      commandService,
    });

    try {
      registerWorkspaceChatMessageHandler();
      const handler = ipcMocks.ipcMain.handle.mock.calls.at(-1)?.[1] as (
        event: unknown,
        message: string,
        requestId: string,
        workflowId: undefined,
        sessionId: string,
      ) => Promise<{
        content: string;
        inputContinuation?: 'command';
        inputRequests?: AxInputRequest[];
      }>;
      const event = {
        sender: { id: 42, mainFrame: ipcMocks.mainFrame, send: vi.fn() },
        senderFrame: ipcMocks.mainFrame,
      };

      const reply = await handler(event, requestMessage, 'request-write-1', undefined, chat.id);

      expect(requests).toHaveLength(2);
      expect(requests[0]?.questions).toHaveProperty('route');
      expect(requests[0]?.questions).toHaveProperty('explicit_execution_now');
      expect(requests[0]?.questions).toHaveProperty('action_scope');
      expect(requests[0]?.questions).not.toHaveProperty('action');
      expect(requests[1]?.questions).toHaveProperty('action');
      expect(requests[1]?.questions).not.toHaveProperty('action_scope');
      expect(requests.some(({ questions }) => Object.hasOwn(questions, 'action_input_0'))).toBe(false);
      expect(reply.inputContinuation).toBe('command');
      expect(reply.inputRequests?.map((request) => request.parameterName)).toEqual(['body']);
      expect(reply.inputRequests).toEqual(expect.arrayContaining([
        expect.objectContaining({
          label: '본문', required: true, capabilityId: 'gmail.message.send', parameterName: 'body',
        }),
      ]));
      expect(execute).toHaveBeenCalledWith(expect.objectContaining({
        name: 'execution.enqueue_once',
        args: expect.objectContaining({ steps: [expect.objectContaining({
          connector: 'gmail', action: 'message.send',
          params: { to: 'person@example.com', subject: '견적서 발송 안내' },
        })] }),
      }), expect.objectContaining({ executionContext: { origin: 'agent' } }));
      expect(queued).not.toHaveBeenCalled();
      expect(agentHarness.runText).not.toHaveBeenCalled();

      const inputMessage = reply.inputRequests!
        .map((input) => `${input.label}: ${input.parameterName === 'body' ? '견적서 발송 안내입니다.' : ''}`)
        .join('\n');
      const continuedMessage = `${inputMessage}\n입력값을 반영해 계속 진행해줘`;
      const continuedChat = store.saveWorkspaceChat({
        id: chat.id,
        messages: [
          { role: 'user', content: requestMessage },
          {
            role: 'assistant',
            content: reply.content,
            inputContinuation: reply.inputContinuation,
            inputRequests: reply.inputRequests,
          },
          { role: 'user', content: continuedMessage },
        ],
      });
      const continuation = await handler(
        event,
        continuedMessage,
        'request-write-2',
        undefined,
        continuedChat.id,
      );

      expect(continuation.content).toContain('큐에 등록했습니다');
      expect(requests).toHaveLength(2);
      expect(fetchImpl).toHaveBeenCalledTimes(requests.length);
      expect(agentHarness.runText).not.toHaveBeenCalled();
      expect(queued).toHaveBeenCalledTimes(1);
      expect(queued.mock.calls[0]?.[0]).toMatchObject({
        steps: [expect.objectContaining({
          connector: 'gmail', action: 'message.send',
          params: {
            to: 'person@example.com',
            subject: '견적서 발송 안내',
            body: '견적서 발송 안내입니다.',
          },
        })],
      });
    } finally {
      clearPendingCommand(chat.id);
      db.close?.();
    }
  });

  it('routes 260 OpenAPI and MCP write tools through Desktop IPC and Jev without invoking one', async () => {
    const db = await createDatabaseAsync(':memory:');
    try {
      const store = new WorkflowStore(db);
      store.setConnection('mcp', true, {});
      store.setConnection('openapi', true, {});
      const paths = Object.fromEntries(Array.from({ length: 200 }, (_, index) => [`/actions/${index}`, {
        post: { operationId: `write_${index}`, summary: `Connected API write ${index}`, responses: { '200': {} } },
      }]));
      const ingestedOpenApi = ingestOpenApiSpec('catalog_api', {
        openapi: '3.0.0', info: { title: 'Large catalog', version: '1.0.0' },
        servers: [{ url: 'https://api.example.test' }], paths,
      });
      const tools: McpToolDefinition[] = Array.from({ length: 60 }, (_, index) => ({
        name: `tool_${index + 200}`, description: `Connected MCP write tool ${index + 200}`, sideEffect: 'EXTERNAL',
      }));
      const mcpClient = new MockMcpClient(tools);
      const mcpToolCall = vi.spyOn(mcpClient, 'callTool');
      const ingestedMcp = await ingestMcpServer('catalog_mcp', mcpClient);
      const userMessage = '연결된 MCP의 tool_259를 지금 실행해줘.';
      const chat = store.saveWorkspaceChat({ messages: [{ role: 'user', content: userMessage }] });
      const queued = vi.fn((_workflow: WorkflowIR) => ({ jobId: 'test-job' }));
      const commandService = new AxCommandService(store, { enqueueOnce: queued });
      const execute = vi.spyOn(commandService, 'execute');
      const requests: Array<{ questions: Record<string, {
        type: string;
        criteria?: Record<string, unknown>;
        instructions?: { focus?: string };
      }> }> = [];
      const targetId = (index: number) => index < 200
        ? `openapi.catalog_api.write_${index}`
        : `mcp.catalog_mcp.tool_${index}`;
      const chooseCapability = (criteria: Record<string, unknown>, id: string): string | undefined =>
        Object.entries(criteria).find(([, value]) => actionCriterionId(value) === id)?.[0];
      const chooseJevOption = (id: string, criteria: Record<string, unknown>): string => {
        if (id === 'route') return 'execution_enqueue_once';
        if (id === 'explicit_execution_now') return 'execute_now';
        if (id === 'action_scope') return 'single_action';
        return chooseCapability(criteria, targetId(259))
          ?? chooseCapability(criteria, targetId(0))
          ?? (Object.hasOwn(criteria, 'none') ? 'none' : Object.keys(criteria)[0] ?? 'none');
      };
      const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
        const request = JSON.parse(String(init?.body)) as (typeof requests)[number];
        requests.push(request);
        const answers: Record<string, unknown> = {};
        for (const [id, question] of Object.entries(request.questions)) {
          if (question.type === 'noul') {
            answers[id] = { type: 'noul', noul: 0.01 };
            continue;
          }
          if (question.type !== 'choice') continue;
          const criteria = question.criteria ?? {};
          const choice = chooseJevOption(id, criteria);
          answers[id] = { type: 'choice', choice, probabilities: { [choice]: 0.99 }, confidence: 0.99 };
        }
        return new Response(JSON.stringify({ model: 'test-jev', answers }), {
          status: 200, headers: { 'content-type': 'application/json' },
        });
      });
      const agentHarness = {
        providerName: 'test-llm',
        runText: vi.fn(async () => { throw new Error('LLM must not choose or execute this action'); }),
      };
      ipcMocks.getCore.mockReturnValue({
        store,
        workspaceSources: { list: vi.fn(() => []) },
        decisionEngine: new JevDecisionEngine({ apiKey: 'test-key', fetch: fetchImpl }),
        agentHarness,
        commandService,
      });

      registerWorkspaceChatMessageHandler();
      const handler = ipcMocks.ipcMain.handle.mock.calls.at(-1)?.[1] as (
        event: unknown, message: string, requestId: string, workflowId: undefined, sessionId: string,
      ) => Promise<{ content: string }>;
      const event = {
        sender: { id: 42, mainFrame: ipcMocks.mainFrame, send: vi.fn() }, senderFrame: ipcMocks.mainFrame,
      };
      const reply = await handler(event, userMessage, 'request-large-catalog', undefined, chat.id);

      expect(reply.content).toContain('큐');
      expect(fetchImpl).toHaveBeenCalledTimes(3);
      expect(requests.every(({ questions }) => Object.values(questions).every((question) =>
        question.type !== 'choice' || Object.keys(question.criteria ?? {}).length <= MAX_DECISION_CHOICE_CRITERIA,
      ))).toBe(true);
      const actionQuestions = requests.flatMap(({ questions }) => Object.entries(questions)
        .filter(([id, question]) => (id === 'action' || id.startsWith('action_group_')) && question.type === 'choice')
        .map(([, question]) => question));
      const actionCriteria = actionQuestions.flatMap((question) =>
        Object.values(question.criteria ?? {}).filter((value): value is string =>
          actionCriterionId(value) !== undefined,
        ));
      const offered = new Set(actionCriteria.flatMap((criterion) => {
        const id = actionCriterionId(criterion);
        return id?.startsWith('openapi.catalog_api.') || id?.startsWith('mcp.catalog_mcp.') ? [id] : [];
      }));
      const ingestedIds = [...ingestedOpenApi.capabilityIds, ...ingestedMcp.capabilityIds];
      expect(offered.size).toBe(260);
      expect(ingestedIds.every((id) => offered.has(id))).toBe(true);
      expect(actionQuestions.every(({ instructions }) =>
        instructions?.focus?.includes('untrusted data') && instructions.focus.includes('approval'),
      )).toBe(true);
      expect(execute).toHaveBeenCalledWith(expect.objectContaining({
        name: 'execution.enqueue_once',
        args: expect.objectContaining({
          steps: [expect.objectContaining({ connector: 'mcp', action: 'catalog_mcp.tool_259' })],
        }),
      }), expect.anything());
      expect(queued).toHaveBeenCalledTimes(1);
      expect(queued.mock.calls[0]?.[0].steps).toEqual([expect.objectContaining({
        connector: 'mcp', action: 'catalog_mcp.tool_259',
      })]);
      expect(queued.mock.calls[0]?.[0]).toMatchObject({
        allowExternalAuto: false,
        steps: [expect.objectContaining({
          connector: 'mcp', action: 'catalog_mcp.tool_259', sideEffect: 'EXTERNAL',
        })],
      });
      expect(mcpToolCall).not.toHaveBeenCalled();
      expect(agentHarness.runText).not.toHaveBeenCalled();
      expect(ingestedOpenApi.capabilityIds).toHaveLength(200);
      expect(ingestedMcp.capabilityIds).toHaveLength(60);
    } finally {
      db.close?.();
    }
  });

  it('updates an active workflow through Desktop IPC and Jev, using only typed prior outputs', async () => {
    const db = await createDatabaseAsync(':memory:');
    try {
      const store = new WorkflowStore(db);
      store.setConnection('slack', true, {});
      const workflow: WorkflowIR = {
        id: 'workflow-chat-step-add',
        name: 'Slack 자료 업무',
        goal: 'Slack 자료를 처리한다',
        inputs: [],
        version: 1,
        trigger: { type: 'manual' },
        steps: [{
          type: 'action',
          id: 'jev_step_1',
          connector: 'slack',
          action: 'messages.read',
          params: { channel: 'PRIVATE_CHANNEL_ID_123' },
          sideEffect: 'NONE',
        }],
        permissions: {},
        approval: [],
        allowExternalAuto: true,
        assumptions: [],
        sideEffects: {},
        dataPolicy: {},
      };
      store.saveWorkflow(workflow);
      store.setWorkflowActive(workflow.id!, true);
      const userMessage = '현재 workflow에 Slack 메시지 표를 텍스트로 바꾸는 단계를 추가해줘.';
      const initialChat = store.saveWorkspaceChat({
        workflowId: workflow.id,
        messages: [],
      });
      const chat = store.saveWorkspaceChat({
        id: initialChat.id,
        messages: [{ role: 'user', content: userMessage }],
      });
      const commandService = new AxCommandService(store);
      const execute = vi.spyOn(commandService, 'execute');
      const requestBodies: string[] = [];
      const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
        const requestBody = String(init?.body);
        requestBodies.push(requestBody);
        const request = JSON.parse(requestBody) as {
          state: { planned_steps?: unknown[] };
          questions: Record<string, { type: string; criteria?: Record<string, unknown> }>;
        };
        const answers = Object.fromEntries(Object.entries(request.questions).map(([id, question]) => {
          if (question.type === 'noul') {
            const probability = id === 'explicit_workflow_update' || id === 'explicit_workflow_step_addition'
              ? 0.99
              : 0.01;
            return [id, { type: 'noul', noul: probability }];
          }
          if (question.type !== 'choice') return [id, { type: 'score', score: 0, probabilities: {} }];
          const selected = id === 'route'
            ? 'workflow_update'
            : id === 'explicit_workflow_update'
              ? 'update_now'
              : id === 'explicit_workflow_step_addition'
                ? 'add_now'
                : id === 'explicit_workflow_step_removal'
                  ? 'do_not_remove'
                  : id === 'next_step' && !request.state.planned_steps?.length
              ? Object.entries(question.criteria ?? {}).find(([, criterion]) =>
                  typeof criterion === 'object' && criterion !== null
                    && 'capability_id' in criterion && criterion.capability_id === 'transform.table_to_text',
              )?.[0] ?? 'none'
              : id === 'next_step'
                ? 'done'
                : Object.hasOwn(question.criteria ?? {}, 'none')
                  ? 'none'
                  : Object.keys(question.criteria ?? {})[0] ?? 'none';
          return [id, {
            type: 'choice', choice: selected,
            probabilities: { [selected]: 0.99 }, confidence: 0.99,
          }];
        }));
        return new Response(JSON.stringify({ model: 'test-jev', answers }), {
          status: 200, headers: { 'content-type': 'application/json' },
        });
      });
      const agentHarness = {
        providerName: 'test-llm',
        runText: vi.fn(async () => ({ output: '단계가 추가되었습니다.', provider: 'test-llm', durationMs: 1, promptChars: 1 })),
      };
      ipcMocks.getCore.mockReturnValue({
        store,
        workspaceSources: { list: vi.fn(() => []) },
        decisionEngine: new JevDecisionEngine({ apiKey: 'test-key', fetch: fetchImpl }),
        agentHarness,
        commandService,
      });

      registerWorkspaceChatMessageHandler();
      const handler = ipcMocks.ipcMain.handle.mock.calls.at(-1)?.[1] as (
        event: unknown, message: string, requestId: string, workflowId: undefined, sessionId: string,
      ) => Promise<{ content: string }>;
      const event = {
        sender: { id: 42, mainFrame: ipcMocks.mainFrame, send: vi.fn() },
        senderFrame: ipcMocks.mainFrame,
      };
      const reply = await handler(event, userMessage, 'request-workflow-step-add', undefined, chat.id);

      expect(reply.content).toContain('자동 실행을 중지');
      expect(execute).toHaveBeenCalledWith(expect.objectContaining({
        name: 'workflow.update',
        args: expect.objectContaining({
          workflowId: workflow.id,
          baseVersion: 1,
          operations: [{
            op: 'upsert_step',
            step: expect.objectContaining({
              type: 'action',
              id: 'jev_step_2',
              connector: 'transform',
              action: 'table_to_text',
              bindings: { table: { from: 'jev_step_1', output: 'messages' } },
            }),
          }],
        }),
      }), expect.anything());
      expect(store.getWorkflow(workflow.id!, 2)?.steps).toHaveLength(2);
      expect(store.isWorkflowActive(workflow.id!)).toBe(false);
      expect(requestBodies.length).toBeGreaterThanOrEqual(3);
      expect(requestBodies.every((body) => !body.includes('PRIVATE_CHANNEL_ID_123'))).toBe(true);
      expect(agentHarness.runText).not.toHaveBeenCalled();
    } finally {
      db.close?.();
    }
  });

  it('resumes a workflow.update input request through the same Desktop chat command', async () => {
    const db = await createDatabaseAsync(':memory:');
    try {
      const store = new WorkflowStore(db);
      store.setConnection('gmail', true, { email: 'primary' });
      const workflow: WorkflowIR = {
        id: 'workflow-chat-step-add-input',
        name: '메일 업무',
        goal: '요청에 따라 메일 업무 단계를 관리한다',
        inputs: [],
        version: 1,
        trigger: { type: 'manual' },
        steps: [],
        permissions: {},
        approval: [],
        allowExternalAuto: false,
        assumptions: [],
        sideEffects: {},
        dataPolicy: {},
      };
      store.saveWorkflow(workflow);
      store.setWorkflowActive(workflow.id!, true);
      const userMessage = '현재 workflow에 Gmail 메일 발송 단계를 추가해줘.';
      const chat = store.saveWorkspaceChat({
        workflowId: workflow.id,
        messages: [{ role: 'user', content: userMessage }],
      });
      const commandService = new AxCommandService(store);
      const execute = vi.spyOn(commandService, 'execute');
      const requestBodies: string[] = [];
      const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
        const body = String(init?.body);
        requestBodies.push(body);
        const request = JSON.parse(body) as {
          state: { planned_steps?: unknown[] };
          questions: Record<string, { type: string; criteria?: Record<string, unknown> }>;
        };
        const answers = Object.fromEntries(Object.entries(request.questions).map(([id, question]) => {
          if (question.type === 'noul') {
            const positive = id === 'explicit_workflow_update' || id === 'explicit_workflow_step_addition';
            return [id, { type: 'noul', noul: positive ? 0.99 : 0.01 }];
          }
          if (question.type !== 'choice') return [id, { type: 'score', score: 0, probabilities: {} }];
          const entries = Object.entries(question.criteria ?? {});
          const selected = id === 'route'
            ? 'workflow_update'
            : id === 'next_step' && !request.state.planned_steps?.length
              ? entries.find(([, criterion]) => typeof criterion === 'object' && criterion !== null
                  && 'capability_id' in criterion && criterion.capability_id === 'gmail.message.send')?.[0] ?? 'none'
              : id === 'next_step'
                ? 'done'
                : entries.some(([key]) => key === 'none') ? 'none' : entries[0]?.[0] ?? 'none';
          return [id, {
            type: 'choice', choice: selected,
            probabilities: { [selected]: 0.99 }, confidence: 0.99,
          }];
        }));
        return new Response(JSON.stringify({ model: 'test-jev', answers }), {
          status: 200, headers: { 'content-type': 'application/json' },
        });
      });
      const agentHarness = {
        providerName: 'test-llm',
        runText: vi.fn(async () => { throw new Error('LLM must not reconstruct a pending Jev plan'); }),
      };
      ipcMocks.getCore.mockReturnValue({
        store,
        workspaceSources: { list: vi.fn(() => []) },
        decisionEngine: new JevDecisionEngine({ apiKey: 'test-key', fetch: fetchImpl }),
        agentHarness,
        commandService,
      });

      registerWorkspaceChatMessageHandler();
      const handler = ipcMocks.ipcMain.handle.mock.calls.at(-1)?.[1] as (
        event: unknown, message: string, requestId: string, workflowId: undefined, sessionId: string,
      ) => Promise<{
        content: string;
        inputContinuation?: 'command';
        inputRequests?: AxInputRequest[];
      }>;
      const event = {
        sender: { id: 42, mainFrame: ipcMocks.mainFrame, send: vi.fn() },
        senderFrame: ipcMocks.mainFrame,
      };

      const reply = await handler(event, userMessage, 'request-workflow-step-input', undefined, chat.id);
      expect(reply.inputContinuation).toBe('command');
      expect(reply.inputRequests).toEqual(expect.arrayContaining([
        expect.objectContaining({ stepId: 'jev_step_1', capabilityId: 'gmail.message.send', parameterName: 'to' }),
        expect.objectContaining({ stepId: 'jev_step_1', capabilityId: 'gmail.message.send', parameterName: 'body' }),
      ]));
      const jevCallsBeforeResume = fetchImpl.mock.calls.length;
      expect(execute.mock.calls[0]?.[0]).toMatchObject({ name: 'workflow.update' });
      expect(store.getWorkflow(workflow.id!, 1)?.steps).toHaveLength(0);
      expect(store.isWorkflowActive(workflow.id!)).toBe(true);

      const continuedMessage = reply.inputRequests!
        .map((input) => `${input.label}: ${input.parameterName === 'to' ? 'person@example.com' : '견적 안내'}`)
        .join('\n');
      const continuedChat = store.saveWorkspaceChat({
        id: chat.id,
        messages: [
          { role: 'user', content: userMessage },
          {
            role: 'assistant', content: reply.content,
            inputContinuation: reply.inputContinuation, inputRequests: reply.inputRequests,
          },
          { role: 'user', content: continuedMessage },
        ],
      });
      expect(commandInputContinuation(continuedChat.messages)).toMatchObject({ request: userMessage });
      expect(claimPendingCommand(chat.id, '다른 요청', [], [])).toEqual({ kind: 'mismatch' });
      const continuation = await handler(
        event, continuedMessage, 'request-workflow-step-input-resume', undefined, continuedChat.id,
      );

      expect(continuation.content).toContain('workflow를 수정했습니다');
      expect(continuation.content).toContain('자동 실행을 중지');
      expect(requestBodies).toHaveLength(jevCallsBeforeResume);
      expect(fetchImpl).toHaveBeenCalledTimes(jevCallsBeforeResume);
      expect(agentHarness.runText).not.toHaveBeenCalled();
      expect(execute).toHaveBeenCalledTimes(2);
      expect(execute.mock.calls[1]?.[0]).toMatchObject({
        name: 'workflow.update',
        args: expect.objectContaining({
          workflowId: workflow.id,
          baseVersion: 1,
          operations: [{
            op: 'upsert_step',
            step: expect.objectContaining({
              id: 'jev_step_1',
              params: { to: 'person@example.com', body: '견적 안내' },
            }),
          }],
        }),
      });
      expect(store.getWorkflow(workflow.id!, 2)?.steps).toHaveLength(1);
      expect(store.getWorkflow(workflow.id!, 2)?.steps[0]).toMatchObject({
        type: 'action', connector: 'gmail', action: 'message.send',
        params: { to: 'person@example.com', body: '견적 안내' },
      });
      expect(store.isWorkflowActive(workflow.id!)).toBe(false);
    } finally {
      db.close?.();
    }
  });
});
