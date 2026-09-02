import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../../store/db.js';
import { WorkflowStore } from '../../store/workflow-store.js';
import type { AxCommandReadContext, AxCommandReadGateway } from './read-gateway.js';
import { HOST_COMMAND_CONTEXT } from './access.js';
import { AxCommandService } from './service.js';
import type { WorkflowIR } from '../../workflow/schema.js';
import type { RepairCandidateOperation } from '../../workflow/repair.js';

const repairCommandCandidate: RepairCandidateOperation = {
  id: 'repair_command_candidate',
  op: 'rename_column',
  sourceId: 'sheet:sales',
  stepId: 'read_sales',
  from: 'customer_count',
  to: 'customers',
  expectedType: 'number',
  actualType: 'integer',
  confidence: 0.65,
};

function repairCommandWorkflow(): WorkflowIR {
  return {
    id: 'discovery_wd_command_repair',
    version: 1,
    name: 'command repair fixture',
    goal: 'repair command를 검증한다',
    trigger: { type: 'manual' },
    inputs: ['sourcePath'],
    steps: [{
      type: 'action',
      id: 'read_sales',
      connector: 'local_sheet',
      action: 'read',
      params: { path: 'sales.csv' },
      sideEffect: 'NONE',
    }, {
      type: 'action',
      id: 'eval_customer_count',
      connector: 'transform',
      action: 'evaluate',
      params: {
        expr: {
          op: 'aggregate',
          input: { op: 'source', sourceId: 'sheet:sales' },
          fn: 'sum',
          column: 'customer_count',
        },
        outputPath: 'field.customer_count',
      },
      bindings: { table: { from: 'read_sales', output: 'sheet' } },
      sideEffect: 'NONE',
    }],
    permissions: {},
    approval: [],
    allowExternalAuto: false,
    assumptions: [],
    sideEffects: {},
    dataPolicy: {},
    outputContract: {
      version: 1,
      fields: [{
        path: 'field.customer_count',
        kind: 'number',
        required: true,
        baseline: { sampleCount: 1, numericMin: 42, numericMax: 42 },
      }],
      inputSchemas: [{
        sourceId: 'sheet:sales',
        stepId: 'read_sales',
        columns: [{ name: 'customer_count', type: 'number' }],
      }],
    },
  };
}

describe('AxCommandService', () => {
  const commandChatContext = { executionContext: { origin: 'agent' as const } };

  it('exposes a bounded command contract instead of a shell surface', async () => {
    const db = await createDatabaseAsync(':memory:');
    const service = new AxCommandService(new WorkflowStore(db));

    const response = await service.execute({ name: 'command.list' });

    expect(response.status).toBe('ok');
    expect(response.data).toMatchObject({
      commands: expect.arrayContaining([
        expect.objectContaining({ name: 'resource.list', mutates: false }),
        expect.objectContaining({ name: 'http.list', lifecycle: 'read', mutates: false }),
        expect.objectContaining({ name: 'workflow.validate', mutates: false }),
        expect.objectContaining({ name: 'ui.present', mutates: false }),
      ]),
    });
    const commandNames = (response.data as { commands: Array<{ name: string }> }).commands.map((entry) => entry.name);
    expect(commandNames).not.toContain('execution.enqueue_once');
    expect(commandNames).not.toContain('workflow.create');
    expect(commandNames).not.toContain('workflow.run');
    expect(JSON.stringify(response.data)).not.toContain('powershell');
  });

  it('lists every saved HTTP endpoint with explicit selection metadata and no credentials', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    store.setConnection('http', true, {
      endpoints: [
        {
          id: 'default',
          label: 'GitHub',
          baseUrl: 'https://api.github.com/',
          authType: 'none',
        },
        {
          id: 'test',
          label: '테스트 REST',
          baseUrl: 'http://127.0.0.1:4820/',
          authType: 'bearer',
          authStored: true,
          token: 'bearer-token-must-not-leak',
          password: 'password-must-not-leak',
        },
        {
          id: 'secure',
          label: '보호된 API',
          baseUrl: 'https://api-user:base-password@example.com/v1?api_key=query-secret',
          authType: 'apiKey',
          authStored: false,
          authHeader: 'X-API-Key',
          token: 'api-key-must-not-leak',
        },
      ],
    });
    const service = new AxCommandService(store);

    const response = await service.execute({ name: 'http.list' });

    expect(response).toMatchObject({
      command: 'http.list',
      status: 'ok',
      data: {
        count: 3,
        requiresExplicitConnectionId: true,
        connections: [
          {
            id: 'default',
            label: 'GitHub',
            baseUrl: 'https://api.github.com/',
            authType: 'none',
            authStored: false,
            authReady: true,
            connected: true,
            usable: true,
          },
          {
            id: 'test',
            label: '테스트 REST',
            baseUrl: 'http://127.0.0.1:4820/',
            authType: 'bearer',
            authStored: true,
            authReady: true,
            connected: true,
            usable: true,
          },
          {
            id: 'secure',
            label: '보호된 API',
            baseUrl: 'https://example.com/v1',
            authType: 'apiKey',
            authStored: false,
            authReady: false,
            connected: true,
            usable: false,
          },
        ],
      },
    });
    const serialized = JSON.stringify(response);
    expect(serialized).not.toContain('bearer-token-must-not-leak');
    expect(serialized).not.toContain('password-must-not-leak');
    expect(serialized).not.toContain('api-key-must-not-leak');
    expect(serialized).not.toContain('base-password');
    expect(serialized).not.toContain('query-secret');
  });

  it('exposes command lifecycle instead of requiring a user-selected execution mode', async () => {
    const db = await createDatabaseAsync(':memory:');
    const service = new AxCommandService(new WorkflowStore(db));

    const commands = await service.execute({ name: 'command.list' }, commandChatContext);
    const entries = (commands.data as { commands: Array<{ name: string; lifecycle: string }> }).commands;
    expect(entries.find((entry) => entry.name === 'execution.enqueue_once')).toMatchObject({ lifecycle: 'ephemeral' });
    expect(entries.find((entry) => entry.name === 'workflow.create')).toMatchObject({ lifecycle: 'workflow' });
    expect(entries.find((entry) => entry.name === 'job.propose')).toMatchObject({ lifecycle: 'workflow' });
    expect(entries.find((entry) => entry.name === 'workflow.run')).toMatchObject({ lifecycle: 'run' });
    expect(entries.find((entry) => entry.name === 'discovery.retry')).toMatchObject({ lifecycle: 'workflow' });
    expect(entries.find((entry) => entry.name === 'job.commit')).toBeUndefined();
  });

  it('blocks workflow and runtime side effects at the direct host boundary', async () => {
    const db = await createDatabaseAsync(':memory:');
    const service = new AxCommandService(new WorkflowStore(db));

    const listed = await service.execute({ name: 'command.list' }, { executionContext: HOST_COMMAND_CONTEXT });
    const entries = (listed.data as { commands: Array<{ name: string }> }).commands;
    expect(entries.map((entry) => entry.name)).not.toContain('workflow.create');
    expect(entries.map((entry) => entry.name)).not.toContain('workflow.run');

    const directCreate = await service.execute({
      name: 'workflow.create',
      args: { name: '직접 호출', goal: 'host 경계를 확인한다' },
    }, { executionContext: HOST_COMMAND_CONTEXT });
    expect(directCreate.status).toBe('forbidden');
    expect(new WorkflowStore(db).listWorkflows()).toHaveLength(0);
  });

  it('keeps context persistence behind the agent boundary and explicit host confirmation', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const service = new AxCommandService(store);
    const workflow = await service.execute({
      name: 'workflow.create',
      args: { name: '정책 workflow', goal: '업무 기준을 저장한다' },
    }, commandChatContext);
    const workflowId = (workflow.data as { workflowId: string }).workflowId;

    const hostAttempt = await service.execute({
      name: 'context.update',
      args: { scope: 'workflow', set: { severity: 'critical' }, confirmed: true },
    }, { executionContext: HOST_COMMAND_CONTEXT, currentWorkflowId: workflowId });
    expect(hostAttempt.status).toBe('forbidden');

    const unconfirmed = await service.execute({
      name: 'context.update',
      args: { scope: 'workflow', set: { severity: 'critical' }, confirmed: true },
    }, { ...commandChatContext, currentWorkflowId: workflowId });
    expect(unconfirmed).toMatchObject({ status: 'needs_input', issues: [{ code: 'context_confirmation_required' }] });
    expect(store.getWorkflowPolicy(workflowId)).toEqual({});

    const confirmed = await service.execute({
      name: 'context.update',
      args: { scope: 'workflow', set: { severity: 'critical', audience: '운영팀' }, confirmed: true },
    }, { ...commandChatContext, currentWorkflowId: workflowId, allowContextUpdate: true });
    expect(confirmed).toMatchObject({
      status: 'ok',
      data: { scope: 'workflow', workflowId, context: { severity: 'critical', audience: '운영팀' } },
    });
    expect(store.getWorkflowPolicy(workflowId)).toEqual({ severity: 'critical', audience: '운영팀' });

    const secondWorkflow = await service.execute({
      name: 'workflow.create',
      args: { name: '다른 정책 workflow', goal: '정책 격리를 확인한다' },
    }, commandChatContext);
    const secondWorkflowId = (secondWorkflow.data as { workflowId: string }).workflowId;
    expect(store.getWorkflowPolicy(secondWorkflowId)).toEqual({});
  });

  it('returns structured missing-argument status without inventing a question', async () => {
    const db = await createDatabaseAsync(':memory:');
    const service = new AxCommandService(new WorkflowStore(db));

    const response = await service.execute({ name: 'workflow.inspect' });

    expect(response.status).toBe('invalid');
    expect(response.issues).toEqual([
      expect.objectContaining({ code: 'missing_argument', path: 'args.workflowId' }),
    ]);
    expect(JSON.stringify(response)).not.toContain('?');
  });

  it('validates a bounded presentation without executing a side effect', async () => {
    const db = await createDatabaseAsync(':memory:');
    const service = new AxCommandService(new WorkflowStore(db));

    const response = await service.execute({
      name: 'ui.present',
      args: {
        title: '처리 전에 확인해 주세요',
        blocks: [{ type: 'decision', label: '판단', value: '운영팀 확인' }],
        inputs: [{ id: 'channel', label: 'Slack 채널', type: 'slack_channel' }],
        actions: [{ id: 'continue', label: '진행', value: '진행해줘' }],
      },
    });

    expect(response).toMatchObject({
      command: 'ui.present',
      status: 'ok',
      data: { presentation: { title: '처리 전에 확인해 주세요' } },
    });
    expect(response.inputRequests).toEqual([]);
    expect(new WorkflowStore(db).listWorkflows()).toHaveLength(0);
  });

  it('rejects executable-looking presentation payloads at the command boundary', async () => {
    const db = await createDatabaseAsync(':memory:');
    const service = new AxCommandService(new WorkflowStore(db));

    const response = await service.execute({
      name: 'ui.present',
      args: { title: '잘못된 카드', actions: [{ id: 'run', label: '실행', value: '' }] },
    });

    expect(response).toMatchObject({ command: 'ui.present', status: 'invalid', issues: [{ code: 'invalid_presentation' }] });
  });

  it('uses the catalog and persisted connections for capability discovery', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    store.setConnection('slack', true);
    const service = new AxCommandService(store);

    const response = await service.execute({
      name: 'capability.list',
      args: { connector: 'slack', kind: 'write' },
    });

    expect(response.status).toBe('ok');
    expect(response.data).toMatchObject({
      capabilities: expect.arrayContaining([
        expect.objectContaining({ connector: 'slack', connection: 'ready' }),
      ]),
    });
  });

  it('preserves bounded read failure details in command issues', async () => {
    const db = await createDatabaseAsync(':memory:');
    const readGateway: AxCommandReadGateway = {
      execute: async () => ({
        tool: 'capabilities.invoke',
        ok: false,
        error: 'http_401',
        errorDetails: {
          status: 401,
          statusText: 'Unauthorized',
          body: '{"error":"unauthorized","hint":"configure the documented lab credential"}',
          truncated: false,
        },
      }),
    };
    const service = new AxCommandService(new WorkflowStore(db), { readGateway });

    const response = await service.execute({
      name: 'capability.invoke',
      args: { id: 'http.request', params: { method: 'GET', path: 'secure/profile' } },
    }, {
      ...commandChatContext,
      designToolContext: { connections: [], connectedConnectorIds: [], allowUntrustedData: true },
    });

    expect(response).toMatchObject({
      command: 'capability.invoke',
      status: 'error',
      issues: [{
        code: 'http_401',
        details: {
          status: 401,
          statusText: 'Unauthorized',
          body: '{"error":"unauthorized","hint":"configure the documented lab credential"}',
          truncated: false,
        },
      }],
    });
  });

  it('strips response headers and caps provider details at the command boundary', async () => {
    const db = await createDatabaseAsync(':memory:');
    const readGateway: AxCommandReadGateway = {
      execute: async () => ({
        tool: 'capabilities.invoke',
        ok: false,
        error: 'http_401',
        errorDetails: {
          status: 401,
          statusText: 'u'.repeat(121),
          body: 'x'.repeat(4_001),
          truncated: false,
          headers: { authorization: 'Bearer should-not-cross-the-boundary' },
        },
      }),
    };
    const service = new AxCommandService(new WorkflowStore(db), { readGateway });

    const response = await service.execute({
      name: 'capability.invoke',
      args: { id: 'http.request', params: { method: 'GET', path: 'secure/profile' } },
    }, {
      ...commandChatContext,
      designToolContext: { connections: [], connectedConnectorIds: [], allowUntrustedData: true },
    });

    expect(response.issues[0]?.details).toEqual({
      status: 401,
      statusText: 'u'.repeat(120),
      body: 'x'.repeat(4_000),
      truncated: true,
    });
    expect(JSON.stringify(response)).not.toContain('should-not-cross-the-boundary');
  });

  it('does not enter the source read gateway for workflow-only commands', async () => {
    const db = await createDatabaseAsync(':memory:');
    let readCalls = 0;
    let contextFactoryCalls = 0;
    const readGateway: AxCommandReadGateway = {
      execute: async () => {
        readCalls += 1;
        return { tool: 'sources.list', ok: true, data: { sources: [] } };
      },
    };
    const service = new AxCommandService(new WorkflowStore(db), { readGateway });
    const readOptions = {
      designToolContextFactory: () => {
        contextFactoryCalls += 1;
        return {
          connections: [],
          connectedConnectorIds: [],
        } satisfies AxCommandReadContext;
      },
    };

    const workflows = await service.execute({ name: 'workflow.list' }, readOptions);
    expect(workflows.status).toBe('ok');
    expect(readCalls).toBe(0);
    expect(contextFactoryCalls).toBe(0);

    const sources = await service.execute({ name: 'source.list' }, readOptions);
    expect(sources.status).toBe('ok');
    expect(readCalls).toBe(1);
    expect(contextFactoryCalls).toBe(1);
  });

  it('creates, updates, and deletes through one versioned command boundary', async () => {
    const db = await createDatabaseAsync(':memory:');
    const service = new AxCommandService(new WorkflowStore(db));

    const created = await service.execute({
      name: 'workflow.create',
      args: { name: '명령 테스트', goal: '명령으로 수정한다' },
    }, commandChatContext);
    expect(created.status).toBe('ok');
    const createdData = created.data as { workflowId: string; version: number };
    expect(createdData.version).toBe(1);

    const updated = await service.execute({
      name: 'workflow.update',
      args: {
        workflowId: createdData.workflowId,
        baseVersion: createdData.version,
        operations: [
          { op: 'set', path: 'name', value: '수정된 workflow' },
          {
            op: 'upsert_step',
            step: {
              type: 'action',
              id: 'notify',
              connector: 'slack',
              action: 'message.send',
              params: { channel: '#ops', text: 'hello' },
            },
          },
        ],
      },
    }, commandChatContext);
    expect(updated.status).toBe('ok');
    expect(updated.data).toMatchObject({ version: 2, workflow: { name: '수정된 workflow' } });

    const stale = await service.execute({
      name: 'workflow.update',
      args: {
        workflowId: createdData.workflowId,
        baseVersion: 1,
        operations: [{ op: 'set', path: 'goal', value: '오래된 수정' }],
      },
    }, commandChatContext);
    expect(stale.status).toBe('conflict');

    const deleted = await service.execute({
      name: 'workflow.delete',
      args: { workflowId: createdData.workflowId, baseVersion: 2 },
    }, commandChatContext);
    expect(deleted).toMatchObject({ status: 'ok', data: { deleted: true } });
  });

  it('lets the catalog provide actionRef and sideEffect instead of trusting model fields', async () => {
    const db = await createDatabaseAsync(':memory:');
    const service = new AxCommandService(new WorkflowStore(db));

    const response = await service.execute({
      name: 'workflow.create',
      args: {
        name: '계약 테스트',
        goal: 'catalog 계약으로 만든다',
        steps: [
          {
            type: 'action',
            id: 'notify',
            connector: 'slack',
            action: 'send_message',
            params: { channel: '#ops', text: 'hello' },
          },
        ],
      },
    }, commandChatContext);

    expect(response.status).toBe('ok');
    expect(response.data).toMatchObject({
      workflow: {
        steps: [
          {
            action: 'message.send',
            actionRef: 'slack.message.send@1',
            sideEffect: 'EXTERNAL',
          },
        ],
      },
    });
  });

  it('normalizes HTTP POST as an approved write step', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    store.setConnection('http', true, { baseUrl: 'https://api.example.com/v1/' });
    const service = new AxCommandService(store);

    const response = await service.execute({
      name: 'workflow.create',
      args: {
        name: 'POST 계약 테스트',
        goal: '외부 API에 검증 payload를 보낸다',
        steps: [
          {
            type: 'action',
            id: 'create_ticket',
            connector: 'http',
            action: 'post',
            params: { path: 'tickets', body: { title: '검증', priority: 'critical' } },
          },
        ],
      },
    }, commandChatContext);

    expect(response).toMatchObject({
      status: 'ok',
      data: {
        workflow: {
          steps: [{ action: 'post', actionRef: 'http.post@1', sideEffect: 'EXTERNAL' }],
        },
      },
    });
  });

  it('runs only an existing workflow through the injected runtime boundary', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const runCalls: string[] = [];
    const service = new AxCommandService(store, {
      runWorkflow: async (workflowId) => {
        runCalls.push(workflowId);
        return { executionId: 'execution-1', status: 'succeeded' };
      },
    });

    const created = await service.execute({
      name: 'workflow.create',
      args: { name: '실행 테스트', goal: '실행 경계를 확인한다' },
    }, commandChatContext);
    const workflowId = (created.data as { workflowId: string }).workflowId;

    const run = await service.execute(
      { name: 'workflow.run', args: { workflowId } },
      commandChatContext,
    );

    expect(run).toMatchObject({
      command: 'workflow.run',
      status: 'ok',
      data: { executionId: 'execution-1' },
    });
    expect(runCalls).toEqual([workflowId]);
  });

  it('allows the agent command to persist a workflow without a separate user mode', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const runCalls: string[] = [];
    const service = new AxCommandService(store, {
      runWorkflow: async (workflowId) => {
        runCalls.push(workflowId);
        return { executionId: 'execution-1', status: 'succeeded' };
      },
    });

    const create = await service.execute({
      name: 'workflow.create',
      args: { name: '대화 workflow', goal: '자연어 command로 저장한다' },
    }, commandChatContext);

    expect(create).toMatchObject({ status: 'ok', data: { operation: 'created' } });
    expect(store.listWorkflows()).toHaveLength(1);
    expect(runCalls).toHaveLength(0);
  });

  it('queues a validated one-shot plan without persisting a workflow', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const queued: unknown[] = [];
    const service = new AxCommandService(store, {
      enqueueOnce: (workflow) => {
        queued.push(workflow);
        return { jobId: 'job-1' };
      },
    });

    const response = await service.execute({
      name: 'execution.enqueue_once',
      args: { name: '일회 테스트', goal: '한 번 실행한다' },
    }, commandChatContext);

    expect(response).toMatchObject({
      command: 'execution.enqueue_once',
      status: 'queued',
      data: { queued: true, ephemeral: true, jobId: 'job-1' },
    });
    expect(queued).toHaveLength(1);
    expect(store.listWorkflows()).toHaveLength(0);
  });

  it('returns one typed target card before queueing a one-shot external share', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    store.setConnection('http', true, {
      endpoints: [
        { id: 'test', label: '테스트 HTTP 연결', baseUrl: 'http://127.0.0.1:4820/', authType: 'none' },
        { id: 'github', label: '깃허브 연결', baseUrl: 'https://api.github.com/', authType: 'none' },
      ],
    });
    store.setConnection('slack', true);
    const queued: unknown[] = [];
    const service = new AxCommandService(store, {
      enqueueOnce: (workflow) => {
        queued.push(workflow);
        return { jobId: 'job-1' };
      },
      readGateway: {
        execute: async () => ({
          tool: 'capabilities.invoke',
          ok: true,
          data: { data: { channels: [{ id: 'C_OPERATIONS', name: '운영' }] } },
        }),
      },
    });

    const response = await service.execute({
      name: 'execution.enqueue_once',
      args: {
        name: '결제 주문 공유',
        goal: '결제 완료 주문을 요약해 Slack으로 공유한다',
        steps: [
          {
            type: 'action',
            id: 'fetch',
            connector: 'http',
            action: 'request',
            params: { method: 'GET', path: '/api/v1/orders?status=paid' },
          },
          {
            type: 'action',
            id: 'notify',
            connector: 'slack',
            action: 'message.send',
            params: { text: '결제 완료 주문 요약' },
          },
        ],
      },
    }, {
        ...commandChatContext,
        designToolContext: {
          connections: store.getConnections(),
          connectedConnectorIds: ['http', 'slack'],
          connectors: {},
        },
      });

    expect(response).toMatchObject({
      command: 'execution.enqueue_once',
      status: 'needs_input',
      data: {
        queued: false,
        pending: true,
        presentation: {
          title: '공유 대상 선택',
          inputs: [
            {
              id: 'execution-http-connection',
              options: [
                { value: 'test', label: '테스트 HTTP 연결' },
                { value: 'github', label: '깃허브 연결' },
              ],
            },
            { id: 'execution-slack-channel', options: [{ value: 'C_OPERATIONS', label: '#운영' }] },
          ],
          actions: [{ id: 'review_execution_targets' }],
        },
      },
    });
    expect(queued).toHaveLength(0);
  });

  it('queues the selected one-shot targets with the originating chat session', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    store.setConnection('http', true, {
      endpoints: [
        { id: 'test', label: '테스트 HTTP 연결', baseUrl: 'http://127.0.0.1:4820/', authType: 'none' },
        { id: 'github', label: '깃허브 연결', baseUrl: 'https://api.github.com/', authType: 'none' },
      ],
    });
    store.setConnection('slack', true);
    const queued: Array<{ workflow: WorkflowIR; sessionId?: string }> = [];
    const service = new AxCommandService(store, {
      enqueueOnce: (workflow, options) => {
        queued.push({ workflow, sessionId: options?.workspaceSessionId });
        return { jobId: 'job-2' };
      },
    });

    const response = await service.execute({
      name: 'execution.enqueue_once',
      args: {
        name: '선택된 주문 공유',
        goal: '선택된 연결과 채널로 한 번 공유한다',
        steps: [
          {
            type: 'action',
            id: 'fetch',
            connector: 'http',
            action: 'request',
            params: {
              method: 'GET',
              connectionId: 'test',
              path: '/api/v1/orders?status=paid',
            },
          },
          {
            type: 'action',
            id: 'notify',
            connector: 'slack',
            action: 'message.send',
            params: { channel: 'C_OPERATIONS', text: '결제 완료 주문 요약' },
          },
        ],
      },
    }, {
        ...commandChatContext,
        workspaceSessionId: 'chat-1',
      });

    expect(response).toMatchObject({
      command: 'execution.enqueue_once',
      status: 'queued',
      data: { queued: true, ephemeral: true, jobId: 'job-2' },
    });
    expect(queued).toHaveLength(1);
    expect(queued[0]?.sessionId).toBe('chat-1');
    expect(queued[0]?.workflow.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'fetch', params: expect.objectContaining({ connectionId: 'test' }) }),
      expect.objectContaining({ id: 'notify', params: expect.objectContaining({ channel: 'C_OPERATIONS' }) }),
    ]));
  });

  it('runs a saved workflow through the command lifecycle', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const runCalls: string[] = [];
    const service = new AxCommandService(store, {
      runWorkflow: async (workflowId) => {
        runCalls.push(workflowId);
        return { executionId: 'execution-1', status: 'succeeded' };
      },
    });

    const created = await service.execute(
      { name: 'workflow.create', args: { name: '저장 workflow', goal: '설계 중 실행하지 않는다' } },
      commandChatContext,
    );
    const workflowId = (created.data as { workflowId: string }).workflowId;
    const run = await service.execute(
      { name: 'workflow.run', args: { workflowId } },
      commandChatContext,
    );

    expect(run).toMatchObject({ status: 'ok', data: { executionId: 'execution-1' } });
    expect(runCalls).toEqual([workflowId]);
  });

  it('routes source discovery through the existing guarded source handlers', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ax-command-source-'));
    writeFileSync(join(dir, 'report.pdf'), 'pdf');
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    store.setConnection('local_folder', true, {
      folders: [{ id: 'folder-1', label: 'Inbox', path: dir }],
    });
    const service = new AxCommandService(store);

    const listed = await service.execute({ name: 'source.files.list', args: { folderId: 'folder-1', extensions: ['.pdf'] } });

    expect(listed.status).toBe('ok');
    expect(JSON.stringify(listed.data)).toContain('report.pdf');
  });

  it('still blocks PDF body text when the caller explicitly denies untrusted data', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ax-command-policy-'));
    writeFileSync(join(dir, 'report.pdf'), 'pdf');
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    store.setConnection('local_folder', true, {
      folders: [{ id: 'folder-1', label: 'Inbox', path: dir }],
    });
    const service = new AxCommandService(store);

    const response = await service.execute({
      name: 'source.file.read',
      args: { folderId: 'folder-1', path: 'report.pdf' },
    }, {
      designToolContext: {
        connections: store.getConnections(),
        connectedConnectorIds: ['local_folder'],
        allowUntrustedData: false,
      },
    });

    expect(response.status).toBe('forbidden');
    expect(response.issues[0]?.code).toBe('source_content_requires_local_ai');
  });

  it('explains a result-quality failure without returning raw execution payloads', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const executionId = store.createExecution({
      workflowId: 'workflow-explain',
      workflowVersion: 2,
      ephemeral: true,
      triggerType: 'manual',
      irJson: JSON.stringify({
        id: 'workflow-explain',
        version: 2,
        name: '결과 설명',
        goal: '결과 품질을 설명한다',
        steps: [],
        permissions: {},
        approval: [],
        allowExternalAuto: false,
        assumptions: [],
        sideEffects: {},
        dataPolicy: {},
        outputContract: {
          version: 1,
          fields: [{
            path: 'field.customer_count',
            kind: 'number',
            required: true,
            baseline: { sampleCount: 2, numericMin: 80, numericMax: 120, numericToleranceRatio: 0.2 },
          }],
          inputSchemas: [],
        },
      }),
    });
    store.finishExecution(executionId, 'failed', 'output_contract_failed', [{
      at: new Date().toISOString(),
      level: 'error',
      code: 'output_contract_failed',
      message: '결과 계약을 통과하지 못했습니다.',
      data: {
        phase: 'before_external_action',
        issues: [{
          code: 'output_volume_anomaly',
          path: 'field.customer_count',
          message: '고객 수가 기준 범위를 벗어났습니다.',
          expected: '80..120 ± 20%',
          actual: 'number outside baseline range',
        }],
      },
    }]);
    const service = new AxCommandService(store);

    const response = await service.execute({
      name: 'execution.explain',
      args: { executionId },
    });

    expect(response).toMatchObject({
      command: 'execution.explain',
      status: 'ok',
      data: {
        executionId,
        workflowId: 'workflow-explain',
        workflowVersion: 2,
        technicalStatus: 'completed',
        resultStatus: 'failed',
        issues: [{ code: 'output_volume_anomaly', path: 'field.customer_count' }],
      },
    });
    expect(JSON.stringify(response)).not.toContain('raw execution payload');
    expect(JSON.stringify(response)).not.toContain('80,120');
  });

  it('inspects and applies a replay-passing repair as a new reversible workflow version', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ax-command-repair-'));
    const sessionRoot = join(root, 'wd_command_repair');
    mkdirSync(sessionRoot, { recursive: true });
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const workflow = repairCommandWorkflow();
    store.saveWorkflow(workflow);
    const now = new Date().toISOString();
    store.saveDiscoverySession({
      id: 'wd_command_repair',
      status: 'published',
      revision: 1,
      userGoal: 'command repair fixture',
      exampleIds: [],
      sourceInventory: [{ id: 'sheet:sales', connector: 'local_sheet', label: 'Sales', kind: 'table', relevance: 1 }],
      observations: [],
      candidates: [],
      budgets: { sourceReadsUsed: 1, sourceReadsMax: 12, elapsedMs: 1 },
      createdAt: now,
      updatedAt: now,
    });
    const example = store.insertDiscoveryExample({
      sessionId: 'wd_command_repair',
      outputArtifactIds: ['output_command_repair'],
      inputArtifactIds: [],
    });
    const manifestPath = join(sessionRoot, 'history.json');
    writeFileSync(manifestPath, JSON.stringify({
      id: 'history_command_repair',
      kind: 'table',
      columns: [{ name: 'customer_count', type: 'integer', nullable: false, inferred: true }],
      rows: [{ index: 0, values: { customer_count: 42 } }],
    }));
    store.insertDiscoverySnapshot({
      id: 'snapshot_command_repair',
      sessionId: 'wd_command_repair',
      exampleId: example.id,
      sourceId: 'sheet:sales',
      kind: 'table',
      manifestPath,
      fingerprint: 'fingerprint_command_repair',
      capturedAt: now,
    });
    store.upsertDiscoveryReplayCase({
      id: 'replay_command_repair',
      sessionId: 'wd_command_repair',
      exampleId: example.id,
      snapshotSetId: 'snapshot_set_command_repair',
      expectedObservationsJson: JSON.stringify([{
        id: 'observation_command_repair',
        exampleId: example.id,
        path: 'field.customer_count',
        value: { kind: 'number', value: 42 },
        role: 'dynamic_value',
        required: true,
      }]),
      createdAt: now,
    });
    const proposal = store.createRepairProposal({
      workflowId: workflow.id!,
      baseVersion: 1,
      candidates: [repairCommandCandidate],
    });
    const service = new AxCommandService(store, { repairSnapshotRoot: root });

    const inspected = await service.execute({
      name: 'repair.inspect',
      args: { repairId: proposal.id },
    });
    expect(inspected).toMatchObject({
      command: 'repair.inspect',
      status: 'ok',
      data: { proposal: { id: proposal.id }, replay: { status: 'passed', total: 1, passed: 1 } },
    });
    expect(JSON.stringify(inspected)).not.toContain('"value":42');

    const applied = await service.execute({
      name: 'repair.apply',
      args: { repairId: proposal.id, candidateId: repairCommandCandidate.id, baseVersion: 1 },
    }, commandChatContext);
    expect(applied).toMatchObject({
      command: 'repair.apply',
      status: 'ok',
      data: {
        workflowId: workflow.id,
        version: 2,
        rollbackVersion: 1,
        replay: { status: 'passed', total: 1, passed: 1 },
      },
    });
    const oldEvaluation = store.getWorkflow(workflow.id!, 1)?.steps.find((step) => step.id === 'eval_customer_count');
    const newEvaluation = store.getWorkflow(workflow.id!)?.steps.find((step) => step.id === 'eval_customer_count');
    expect(oldEvaluation).toMatchObject({
      type: 'action',
      params: { expr: { column: 'customer_count' } },
    });
    expect(newEvaluation).toMatchObject({
      type: 'action',
      params: { expr: { column: 'customers' } },
    });
    expect(store.getRepairProposal(proposal.id)).toMatchObject({ status: 'applied', appliedVersion: 2 });
    db.close?.();
  });

  it('keeps repair rejection behind the agent mutation boundary', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const workflow = repairCommandWorkflow();
    store.saveWorkflow(workflow);
    const proposal = store.createRepairProposal({
      workflowId: workflow.id!,
      baseVersion: 1,
      candidates: [repairCommandCandidate],
    });
    const service = new AxCommandService(store);
    const args = { repairId: proposal.id, baseVersion: 1, reason: '현재는 유지' };

    const hostResponse = await service.execute({ name: 'repair.reject', args });
    expect(hostResponse.status).toBe('forbidden');
    const agentResponse = await service.execute({ name: 'repair.reject', args }, commandChatContext);

    expect(agentResponse).toMatchObject({
      command: 'repair.reject',
      status: 'ok',
      data: { repairId: proposal.id, workflowId: workflow.id, status: 'rejected' },
    });
    db.close?.();
  });
});
