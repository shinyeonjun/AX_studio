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

  it('reports malformed connection JSON instead of treating it as no connection', async () => {
    const db = await createDatabaseAsync(':memory:');
    db.prepare('INSERT INTO connections (connector, connected, config_json) VALUES (?, ?, ?)').run(
      'local_folder',
      1,
      '[]',
    );
    const store = new WorkflowStore(db);

    expect(() => store.getConnections()).toThrow('연결 local_folder의 JSON이 손상되었습니다');
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
