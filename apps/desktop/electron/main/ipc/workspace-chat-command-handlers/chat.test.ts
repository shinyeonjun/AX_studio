import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AxCommandService,
  createDatabaseAsync,
  JevDecisionEngine,
  WorkflowStore,
  type AxInputRequest,
  type AxUiPresentation,
  type WorkflowIR,
} from '@ax-studio/core';
import * as axCore from '@ax-studio/core';
import { claimPendingCommand, clearPendingCommand } from './pending-command.js';
import { commandInputContinuation } from '../chat-boundary.js';

type MockJevQuestion = {
  type: string;
  criteria?: Record<string, unknown>;
  instructions?: Record<string, unknown>;
};

type MockJevRequest = {
  state: { planned_steps?: unknown[] };
  questions: Record<string, MockJevQuestion>;
};

function mockJevAnswers(
  request: MockJevRequest,
  input: {
    route: string;
    needsNaturalLanguageAnswer: boolean;
    selectTool?: (candidate: Record<string, unknown>) => boolean;
    selectChoice?: (id: string, question: MockJevQuestion) => string | undefined;
  },
): Record<string, unknown> {
  return Object.fromEntries(Object.entries(request.questions).map(([id, question]) => {
    if (question.type === 'boolean' || question.type === 'noul') {
      const probability = id === 'needs_natural_language_answer'
        ? Number(input.needsNaturalLanguageAnswer)
        : id.startsWith('tool_')
          ? Number(input.selectTool?.(question.instructions?.candidate as Record<string, unknown>) === true)
          : 0;
      return [id, { type: 'noul', noul: probability ? 0.99 : 0.01 }];
    }
    if (question.type === 'choice') {
      const criteria = question.criteria ?? {};
      const selected = id === 'route'
        ? input.route
        : input.selectChoice?.(id, question)
          ?? (Object.hasOwn(criteria, 'none') ? 'none' : Object.keys(criteria)[0] ?? 'none');
      return [id, {
        type: 'choice', choice: selected,
        probabilities: { [selected]: 0.99 }, confidence: 0.99,
      }];
    }
    return [id, { type: 'score', score: 0, probabilities: {} }];
  }));
}

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

type ChatHandler = (
  event: unknown, message: string, requestId: string, workflowId: undefined, sessionId: string,
) => Promise<{ content: string; presentations?: AxUiPresentation[] }>;

/** Clicks the host-rendered confirm_mutation action the way the renderer does: its value becomes the next user turn. */
async function confirmMutation(
  handler: ChatHandler,
  event: unknown,
  store: WorkflowStore,
  sessionId: string,
  previousUserMessage: string,
  proposal: { content: string; presentations?: AxUiPresentation[] },
) {
  const action = proposal.presentations?.flatMap(({ actions }) => actions)
    .find((candidate) => (candidate.purpose as string) === 'confirm_mutation');
  expect(action?.id).toMatch(/^confirm_mutation:/u);
  const stored = store.getWorkspaceChat(sessionId)!;
  store.saveWorkspaceChat({
    id: sessionId,
    messages: [
      ...stored.messages.filter((message) => message.content !== previousUserMessage || message.role !== 'user'),
      { role: 'user', content: previousUserMessage },
      { role: 'assistant', content: proposal.content, presentations: proposal.presentations },
      { role: 'user', content: action!.value },
    ],
  });
  return handler(event, action!.value, `confirm-${sessionId}`, undefined, sessionId);
}

describe('Desktop workspace chat Jev routing', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('routes IPC chat through Jev and caches read operations by connection revision', async () => {
    const events: string[] = [];
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      events.push('jev');
      const request = JSON.parse(String(init?.body)) as MockJevRequest;
      const answers = mockJevAnswers(request, {
        route: 'answer', needsNaturalLanguageAnswer: true,
      });
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
    const requests: MockJevRequest[] = [];
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      const request = JSON.parse(String(init?.body)) as MockJevRequest;
      requests.push(request);
      const answers = mockJevAnswers(request, {
        route: 'execution_enqueue_once', needsNaturalLanguageAnswer: false,
        selectTool: candidate => candidate.capability_id === 'gmail.message.send',
        selectChoice: (id, question) => {
          const entries = Object.entries(question.criteria ?? {});
          if (id === 'explicit_execution_now') return 'execute_now';
          if (id === 'next_step') {
            return entries.find(([, criterion]) => actionCriterionId(criterion) === 'gmail.message.send')?.[0];
          }
          return undefined;
        },
      });
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
      expect(requests[0]?.questions).toHaveProperty('needs_natural_language_answer');
      expect(Object.values(requests[0]?.questions ?? {}).some(question =>
        question.type === 'noul'
        && (question.instructions?.candidate as Record<string, unknown> | undefined)?.capability_id === 'gmail.message.send',
      )).toBe(true);
      expect(reply).toMatchObject({ presentations: expect.arrayContaining([expect.objectContaining({ title: '실행 전 계획 검사', inputs: [], actions: [] })]) });
      expect(requests[1]?.questions).toHaveProperty('requirements');
      expect(requests[1]?.questions).toHaveProperty('scope');
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
        const request = JSON.parse(requestBody) as MockJevRequest;
        const answers = mockJevAnswers(request, {
          route: 'workflow_update', needsNaturalLanguageAnswer: false,
          selectTool: candidate => candidate.capability_id === 'transform.table_to_text',
          selectChoice: (id, question) => {
            if (id === 'explicit_workflow_update') return 'update_now';
            if (id === 'explicit_workflow_step_addition') return 'add_now';
            if (id === 'explicit_workflow_step_removal') return 'do_not_remove';
            if (id === 'next_step' && !request.state.planned_steps?.length) {
              return Object.entries(question.criteria ?? {}).find(([, criterion]) =>
                typeof criterion === 'object' && criterion !== null
                  && 'capability_id' in criterion && criterion.capability_id === 'transform.table_to_text',
              )?.[0];
            }
            if (id === 'next_step') return 'done';
            return undefined;
          },
        });
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
      ) => Promise<{ content: string; presentations?: AxUiPresentation[] }>;
      const event = {
        sender: { id: 42, mainFrame: ipcMocks.mainFrame, send: vi.fn() },
        senderFrame: ipcMocks.mainFrame,
      };
      const proposal = await handler(event, userMessage, 'request-workflow-step-add', undefined, chat.id);
      // The Jev-compiled update waits for the host-rendered confirmation card.
      expect(store.getWorkflow(workflow.id!)?.version).toBe(1);
      expect(store.isWorkflowActive(workflow.id!)).toBe(true);
      const reply = await confirmMutation(handler, event, store, chat.id, userMessage, proposal);

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
      expect(store.getWorkflow(workflow.id!)?.allowExternalAuto).toBe(false);
      expect(requestBodies).toHaveLength(2);
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
        const request = JSON.parse(body) as MockJevRequest;
        const answers = mockJevAnswers(request, {
          route: 'workflow_update', needsNaturalLanguageAnswer: false,
          selectTool: candidate => candidate.capability_id === 'gmail.message.send',
          selectChoice: (id, question) => {
            if (id === 'explicit_workflow_update') return 'update_now';
            if (id === 'explicit_workflow_step_addition') return 'add_now';
            if (id === 'next_step' && !request.state.planned_steps?.length) {
              return Object.entries(question.criteria ?? {}).find(([, criterion]) =>
                typeof criterion === 'object' && criterion !== null
                  && 'capability_id' in criterion && criterion.capability_id === 'gmail.message.send',
              )?.[0];
            }
            if (id === 'next_step') return 'done';
            return undefined;
          },
        });
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
        presentations?: AxUiPresentation[];
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
      const proposal = await handler(
        event, continuedMessage, 'request-workflow-step-input-resume', undefined, continuedChat.id,
      );
      expect(store.getWorkflow(workflow.id!)?.version).toBe(1);
      const continuation = await confirmMutation(handler, event, store, continuedChat.id, continuedMessage, proposal);

      expect(continuation.content).toContain('workflow를 수정했습니다');
      expect(continuation.content).toContain('자동 실행을 중지');
      expect(requestBodies).toHaveLength(jevCallsBeforeResume);
      expect(fetchImpl).toHaveBeenCalledTimes(jevCallsBeforeResume);
      expect(agentHarness.runText).not.toHaveBeenCalled();
      expect(execute).toHaveBeenCalledTimes(3);
      expect(execute.mock.calls[2]?.[0]).toMatchObject({ name: 'mutation.commit' });
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
