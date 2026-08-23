import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../../store/db.js';
import { WorkflowStore } from '../../store/workflow-store.js';
import { AxCommandService } from './service.js';

describe('AxCommandService', () => {
  const authoringContext = { executionContext: { interactionMode: 'authoring' as const, executionMode: 'workflow' as const } };

  it('exposes a bounded command contract instead of a shell surface', async () => {
    const db = await createDatabaseAsync(':memory:');
    const service = new AxCommandService(new WorkflowStore(db));

    const response = await service.execute({ name: 'command.list' });

    expect(response.status).toBe('ok');
    expect(response.data).toMatchObject({
      commands: expect.arrayContaining([
        expect.objectContaining({ name: 'resource.list', mutates: false }),
        expect.objectContaining({ name: 'workflow.validate', mutates: false }),
      ]),
    });
    expect(JSON.stringify(response.data)).not.toContain('powershell');
    expect(JSON.stringify(response.data)).not.toContain('workflow.create');
    expect(JSON.stringify(response.data)).not.toContain('workflow.run');
  });

  it('only exposes workflow mutations and once execution inside the matching context', async () => {
    const db = await createDatabaseAsync(':memory:');
    const service = new AxCommandService(new WorkflowStore(db));

    const authoring = await service.execute(
      { name: 'command.list' },
      { executionContext: { interactionMode: 'authoring', executionMode: 'workflow' } },
    );
    const once = await service.execute(
      { name: 'command.list' },
      { executionContext: { interactionMode: 'authoring', executionMode: 'once' } },
    );

    const authoringNames = (authoring.data as { commands: Array<{ name: string }> }).commands.map((entry) => entry.name);
    const onceNames = (once.data as { commands: Array<{ name: string }> }).commands.map((entry) => entry.name);
    expect(authoringNames).toContain('workflow.create');
    expect(authoringNames).not.toContain('workflow.run');
    expect(onceNames).toContain('workflow.create');
    expect(onceNames).toContain('workflow.run');
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

  it('creates, updates, and deletes through one versioned command boundary', async () => {
    const db = await createDatabaseAsync(':memory:');
    const service = new AxCommandService(new WorkflowStore(db));

    const created = await service.execute({
      name: 'workflow.create',
      args: { name: '명령 테스트', goal: '명령으로 수정한다' },
    }, authoringContext);
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
    }, authoringContext);
    expect(updated.status).toBe('ok');
    expect(updated.data).toMatchObject({ version: 2, workflow: { name: '수정된 workflow' } });

    const stale = await service.execute({
      name: 'workflow.update',
      args: {
        workflowId: createdData.workflowId,
        baseVersion: 1,
        operations: [{ op: 'set', path: 'goal', value: '오래된 수정' }],
      },
    }, authoringContext);
    expect(stale.status).toBe('conflict');

    const deleted = await service.execute({
      name: 'workflow.delete',
      args: { workflowId: createdData.workflowId, baseVersion: 2 },
    }, authoringContext);
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
    }, authoringContext);

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
    }, { executionContext: { interactionMode: 'authoring', executionMode: 'once' } });
    const workflowId = (created.data as { workflowId: string }).workflowId;

    const run = await service.execute(
      { name: 'workflow.run', args: { workflowId } },
      { executionContext: { interactionMode: 'authoring', executionMode: 'once' } },
    );

    expect(run).toMatchObject({
      command: 'workflow.run',
      status: 'ok',
      data: { executionId: 'execution-1' },
    });
    expect(runCalls).toEqual([workflowId]);
  });

  it('blocks workflow mutations without an explicit authoring context', async () => {
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
      args: { name: '차단 테스트', goal: '평챗에서는 저장하지 않는다' },
    });

    expect(create).toMatchObject({ status: 'forbidden', issues: [{ code: 'command_forbidden' }] });
    expect(store.listWorkflows()).toHaveLength(0);
    expect(runCalls).toHaveLength(0);
  });

  it('does not run a saved workflow from the /workflow authoring context', async () => {
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
      authoringContext,
    );
    const workflowId = (created.data as { workflowId: string }).workflowId;
    const run = await service.execute(
      { name: 'workflow.run', args: { workflowId } },
      authoringContext,
    );

    expect(run).toMatchObject({ status: 'forbidden', issues: [{ code: 'command_forbidden' }] });
    expect(runCalls).toHaveLength(0);
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
        interactionMode: 'plain_chat',
        allowUntrustedData: false,
      },
    });

    expect(response.status).toBe('forbidden');
    expect(response.issues[0]?.code).toBe('source_content_requires_local_ai');
  });
});
