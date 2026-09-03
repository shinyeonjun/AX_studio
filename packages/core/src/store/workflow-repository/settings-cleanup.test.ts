import { describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../db.js';
import { WorkflowStore } from '../workflow-store.js';

describe('workflow settings and cleanup persistence', () => {
  it('fails closed when the persisted global execution state is not boolean', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);

    expect(store.getGlobalActive()).toBe(true);
    store.setSetting('globalActive', false);
    expect(store.getGlobalActive()).toBe(false);
    store.setSetting('globalActive', true);
    expect(store.getGlobalActive()).toBe(true);
    store.setSetting('globalActive', 'true');
    expect(store.getGlobalActive()).toBe(false);
    store.setSetting('globalActive', { enabled: true });
    expect(store.getGlobalActive()).toBe(false);
  });

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
});
