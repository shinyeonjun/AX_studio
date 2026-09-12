import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDatabaseAsync } from '../../../persistence/db.js';
import { WorkflowStore } from '../../../persistence/workflow-store.js';
import type { WorkflowIR } from '../../../workflow/schema.js';
import { WorkflowRuntime } from '../../engine.js';
import { Scheduler } from '../../scheduler.js';
import { TriggerEventCoordinator } from '../../trigger-engine/events.js';
import { PUSH_TRIGGER_DRIVERS } from '../../../connectors/packages/catalog.js';

function workflow(trigger: WorkflowIR['trigger']): WorkflowIR {
  return {
    id: 'partial-execution', name: '부분 실행 실패', goal: '완료된 발송 중복 방지', version: 1, trigger,
    steps: [
      { type: 'action', id: 'send', connector: 'slack', action: 'message.send', params: { channel: '#test', text: 'once' }, sideEffect: 'EXTERNAL' },
      { type: 'action', id: 'read', connector: 'http', action: 'request', params: { method: 'GET', path: '/status' }, sideEffect: 'NONE' },
    ],
    permissions: {}, approval: [], allowExternalAuto: true, assumptions: [], sideEffects: {}, dataPolicy: {},
  };
}

describe('automatic retries after external effects', () => {
  afterEach(() => vi.useRealTimers());

  it.each(['once', 'schedule'] as const)('does not resend a %s occurrence when a later read fails', async (type) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-12T00:00:00Z'));
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const send = vi.fn(async () => ({ ok: true, data: { messageId: 'sent' } }));
    const runtime = new WorkflowRuntime({ store, globalActive: true, workflowActive: {}, connectors: {
      slack: { name: 'controlled-slack', execute: send },
      http: { name: 'controlled-http', execute: async () => ({ ok: false, error: 'read failed' }) },
    } });
    store.saveWorkflow(workflow(type === 'once'
      ? { type, runAt: '2026-09-11T23:59:59Z' }
      : { type, schedule: '* * * * *', timezone: 'UTC' }));
    store.setWorkflowActive('partial-execution', true);
    const scheduler = new Scheduler(store, runtime);
    try {
      scheduler.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(store.listExecutions()[0]?.status).toBe('failed');
      expect(send).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(send).toHaveBeenCalledTimes(1);
      expect(store.listExecutions()).toHaveLength(1);
      if (type === 'once') expect(store.isWorkflowActive('partial-execution')).toBe(false);
    } finally { scheduler.stop(); await runtime.waitForIdle(); db.close?.(); }
  });

  it('does not replay a redelivered webhook after sending and then failing', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const send = vi.fn(async () => ({ ok: true, data: { messageId: 'sent' } }));
    const runtime = new WorkflowRuntime({ store, globalActive: true, workflowActive: {}, connectors: {
      slack: { name: 'controlled-slack', execute: send },
      http: { name: 'controlled-http', execute: async () => ({ ok: false, error: 'read failed' }) },
    } });
    store.saveWorkflow(workflow({ type: 'webhook.inbound', path: 'partial' }));
    store.setWorkflowActive('partial-execution', true);
    const driver = PUSH_TRIGGER_DRIVERS.find((entry) => entry.triggerType === 'webhook.inbound')!;
    const event = { type: 'webhook.inbound', payload: { path: 'partial', eventId: 'same-event', body: '{}' } };
    try {
      const coordinator = new TriggerEventCoordinator(store, runtime, () => true);
      await coordinator.handlePushEvent(driver, event);
      expect(store.listExecutions()[0]?.status).toBe('failed');
      expect(send).toHaveBeenCalledTimes(1);
      // Recreating the coordinator removes in-memory deduplication as a source of false confidence.
      await new TriggerEventCoordinator(store, runtime, () => true).handlePushEvent(driver, event);
      expect(send).toHaveBeenCalledTimes(1);
      expect(store.listExecutions()).toHaveLength(1);
    } finally { db.close?.(); }
  });
});
