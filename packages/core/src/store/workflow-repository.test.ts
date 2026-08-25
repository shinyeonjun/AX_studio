import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDatabaseAsync } from './db.js';
import { WorkflowStore } from './workflow-store.js';

describe('workflow persistence', () => {
  it('reports when activating a workflow ID that does not exist', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);

    expect(store.setWorkflowActive('missing-workflow', true)).toBe(false);
  });

  it('degrades malformed connection JSON instead of failing the whole settings load', async () => {
    const db = await createDatabaseAsync(':memory:');
    db.prepare('INSERT INTO connections (connector, connected, config_json) VALUES (?, ?, ?)').run(
      'local_folder',
      1,
      '[]',
    );
    const store = new WorkflowStore(db);

    const connections = store.getConnections();
    expect(connections.find((entry) => entry.connector === 'local_folder')).toMatchObject({
      connected: false,
      configCorrupted: true,
    });
  });

  it('prunes scheduler/trigger state and receipts when a workflow is deleted', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const { workflowId } = store.saveWorkflow({
      id: 'wf-cleanup',
      name: '정리 테스트',
      goal: '삭제 시 부속 상태 정리',
      version: 1,
      steps: [],
      permissions: {},
      approval: [],
      allowExternalAuto: true,
      assumptions: [],
      sideEffects: {},
      dataPolicy: {},
    });
    store.setSetting('scheduler.lastFired', { [workflowId]: '2026-08-25T00:00', other: '2026-08-25T00:01' });
    store.setSetting('trigger.cursors', { [workflowId]: { initialized: true }, other: {} });
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO trigger_receipts (dedupe_key, workflow_id, trigger_type, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run('dedupe-1', workflowId, 'schedule', 'done', now, now);

    expect(store.deleteWorkflow(workflowId)).toBe(true);

    expect(store.getSetting<Record<string, string>>('scheduler.lastFired', {})).toEqual({ other: '2026-08-25T00:01' });
    expect(store.getSetting<Record<string, unknown>>('trigger.cursors', {})).toEqual({ other: {} });
    const receipts = db.prepare('SELECT COUNT(*) AS count FROM trigger_receipts WHERE workflow_id = ?').get(workflowId) as { count: number };
    expect(receipts.count).toBe(0);
  });

  it('allocates a new monotonic version for every save', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const workflow = {
      id: 'workflow-1',
      name: '버전 테스트',
      goal: '저장 버전 확인',
      version: 1,
      steps: [],
      permissions: {},
      approval: [],
      allowExternalAuto: true,
      assumptions: [],
      sideEffects: {},
      dataPolicy: {},
    };

    expect(store.saveWorkflow(workflow).version).toBe(1);
    expect(store.saveWorkflow(workflow).version).toBe(2);
    expect(store.getWorkflow('workflow-1')?.version).toBe(2);
  });

  it('persists new workflows as disabled until explicitly enabled', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const { workflowId } = store.saveWorkflow({
      id: 'wf-disabled',
      name: '비활성 저장',
      goal: 'test',
      version: 1,
      steps: [],
      permissions: {},
      approval: [],
      allowExternalAuto: true,
      assumptions: [],
      sideEffects: {},
      dataPolicy: {},
    });
    const listed = store.listWorkflows().find((row) => row.id === workflowId);
    expect(listed?.active).toBe(false);
  });

  it('persists a committed workflow and can reopen it after the database closes', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'ax-studio-db-'));
    const filePath = join(directory, 'state.sqlite');

    try {
      const db = await createDatabaseAsync(filePath);
      const store = new WorkflowStore(db);
      store.saveWorkflow({
        id: 'workflow-persisted',
        name: '영속성 테스트',
        goal: '커밋된 workflow를 다시 읽기',
        version: 1,
        trigger: { type: 'manual' },
        steps: [],
        permissions: {},
        approval: [],
        allowExternalAuto: true,
        assumptions: [],
        sideEffects: {},
        dataPolicy: {},
      });
      db.close?.();

      const reopened = await createDatabaseAsync(filePath);
      expect(new WorkflowStore(reopened).getWorkflow('workflow-persisted')?.name).toBe('영속성 테스트');
      reopened.close?.();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('does not persist an executable workflow with missing action parameters', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);

    expect(() =>
      store.saveWorkflow({
        id: 'workflow-incomplete',
        name: '미완성 workflow',
        goal: 'Slack에 보내기',
        version: 1,
        trigger: { type: 'manual' },
        steps: [
          {
            type: 'action',
            id: 'notify',
            connector: 'slack',
            action: 'message.send',
            params: { channel: '#ops' },
            sideEffect: 'EXTERNAL',
          },
        ],
        permissions: {},
        approval: [],
        allowExternalAuto: true,
        assumptions: [],
        sideEffects: {},
        dataPolicy: {},
      }),
    ).toThrow('필요한 데이터 계약을 이전 단계나 트리거가 제공하지 않습니다.');

    expect(store.getWorkflow('workflow-incomplete')).toBeNull();
  });
});
