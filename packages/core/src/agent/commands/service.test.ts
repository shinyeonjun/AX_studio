import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../../store/db.js';
import { WorkflowStore } from '../../store/workflow-store.js';
import type { AxCommandReadContext, AxCommandReadGateway } from './read-gateway.js';
import { HOST_COMMAND_CONTEXT } from './access.js';
import { AxCommandService } from './service.js';

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
});
