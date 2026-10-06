import { describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../db.js';
import { WorkflowStore } from '../workflow-store.js';
import { LAST_OUTCOME_SETTING_PREFIX } from '../../runtime/scheduler/service.js';
import { DEAD_LETTER_SETTING } from '../../runtime/trigger-engine/receipts.js';
import { PUSH_EVENT_JOURNAL_SETTING } from '../../runtime/trigger-engine/events.js';

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
      inputs: [],
      steps: [],
      permissions: {},
      approval: [],
      allowExternalAuto: true,
      assumptions: [],
      sideEffects: {},
      dataPolicy: {},
    });
    store.setSetting('scheduler.lastFired', { [workflowId]: '2026-08-25T00:00', other: '2026-08-25T00:01' });
    store.setSetting(`scheduler.lastFired:${encodeURIComponent(workflowId)}`, '2026-08-25T00:00');
    store.setSetting('trigger.cursors', { [workflowId]: { initialized: true }, other: {} });
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO trigger_receipts (dedupe_key, workflow_id, trigger_type, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run('dedupe-1', workflowId, 'schedule', 'done', now, now);

    expect(store.deleteWorkflow(workflowId)).toBe(true);

    expect(store.getSetting<Record<string, string>>('scheduler.lastFired', {})).toEqual({ other: '2026-08-25T00:01' });
    expect(store.getSetting(`scheduler.lastFired:${encodeURIComponent(workflowId)}`, null)).toBeNull();
    expect(store.getSetting<Record<string, unknown>>('trigger.cursors', {})).toEqual({ other: {} });
    const receipts = db.prepare('SELECT COUNT(*) AS count FROM trigger_receipts WHERE workflow_id = ?').get(workflowId) as { count: number };
    expect(receipts.count).toBe(0);
  });

  it('prunes per-workflow outcome, retry-attempt and dead-letter state but keeps other workflows', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const base = {
      goal: '삭제 시 부속 상태 정리', version: 1, inputs: [], steps: [], permissions: {}, approval: [],
      allowExternalAuto: true, assumptions: [], sideEffects: {}, dataPolicy: {},
    };
    const { workflowId } = store.saveWorkflow({ ...base, id: 'wf-a', name: 'A' });
    store.saveWorkflow({ ...base, id: 'wf-a-b', name: 'A-B' });
    const deadKey = `${workflowId}:slack.new_message:1`;
    const otherKey = 'wf-a-b:slack.new_message:1';
    store.claimTriggerReceipt({ dedupeKey: deadKey, workflowId, triggerType: 'slack.new_message' });
    store.claimTriggerReceipt({ dedupeKey: otherKey, workflowId: 'wf-a-b', triggerType: 'slack.new_message' });
    store.setSetting(`${LAST_OUTCOME_SETTING_PREFIX}${encodeURIComponent(workflowId)}`, { status: 'failed' });
    store.setSetting(`${LAST_OUTCOME_SETTING_PREFIX}wf-a-b`, { status: 'failed' });
    store.setSetting(`trigger.receiptAttempt:${encodeURIComponent(deadKey)}`, { attempts: 1, nextAttemptAt: 0 });
    store.setSetting(`trigger.receiptAttempt:${encodeURIComponent(otherKey)}`, { attempts: 1, nextAttemptAt: 0 });
    store.setSetting(DEAD_LETTER_SETTING, [
      { dedupeKey: deadKey, workflowId, attempts: 5, reason: 'max_attempts_exceeded', at: '2026-10-01T00:00:00.000Z' },
      { dedupeKey: otherKey, workflowId: 'wf-a-b', attempts: 5, reason: 'max_attempts_exceeded', at: '2026-10-01T00:00:00.000Z' },
    ]);
    store.setSetting(PUSH_EVENT_JOURNAL_SETTING, [{ id: 'j1' }]);

    expect(store.deleteWorkflow(workflowId)).toBe(true);

    expect(store.getSetting(`${LAST_OUTCOME_SETTING_PREFIX}${encodeURIComponent(workflowId)}`, null)).toBeNull();
    expect(store.getSetting(`${LAST_OUTCOME_SETTING_PREFIX}wf-a-b`, null)).not.toBeNull();
    expect(store.getSetting(`trigger.receiptAttempt:${encodeURIComponent(deadKey)}`, null)).toBeNull();
    expect(store.getSetting(`trigger.receiptAttempt:${encodeURIComponent(otherKey)}`, null)).not.toBeNull();
    expect(store.getSetting<Array<{ workflowId: string }>>(DEAD_LETTER_SETTING, []).map((entry) => entry.workflowId)).toEqual(['wf-a-b']);
    // Journal entries are per trigger type (not per workflow) and are left alone.
    expect(store.getSetting(PUSH_EVENT_JOURNAL_SETTING, [])).toEqual([{ id: 'j1' }]);
  });

  it('refuses to delete a workflow with an active execution', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const { workflowId } = store.saveWorkflow({
      id: 'wf-active-delete',
      name: '실행 중 삭제 보호',
      goal: '실행 중인 워크플로우 보존',
      version: 1,
      inputs: [],
      steps: [],
      permissions: {},
      approval: [],
      allowExternalAuto: true,
      assumptions: [],
      sideEffects: {},
      dataPolicy: {},
    });
    const executionId = store.createExecution({ workflowId, ephemeral: false });

    expect(() => store.deleteWorkflow(workflowId)).toThrow('실행 중인 워크플로우는 삭제할 수 없습니다.');
    expect(store.getWorkflow(workflowId)).not.toBeNull();

    store.finishExecution(executionId, 'success');
    expect(store.deleteWorkflow(workflowId)).toBe(true);
  });
});
