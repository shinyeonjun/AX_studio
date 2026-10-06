import { describe, expect, it, vi } from 'vitest';
import { PUSH_TRIGGER_DRIVERS } from '../../connectors/packages/catalog.js';
import { createDatabaseAsync } from '../../persistence/db.js';
import { WorkflowStore } from '../../persistence/workflow-store.js';
import type { WorkflowIR } from '../../workflow/schema.js';
import { TriggerEventCoordinator, PUSH_EVENT_JOURNAL_SETTING } from './events.js';
import { eventDedupeKey } from './helpers.js';
import { DEAD_LETTER_SETTING, MAX_TRIGGER_ATTEMPTS, recordTriggerFailure, triggerRetryBlocked } from './receipts.js';

const workflow: WorkflowIR = {
  name: 'Slack relay', goal: 'Relay Slack messages', version: 1,
  trigger: { type: 'slack.new_message', channel: '#ops' },
  inputs: [],
  steps: [
    { type: 'action', id: 'send', connector: 'gmail', action: 'message.send',
      params: { to: 'test@example.invalid', body: 'synthetic' }, sideEffect: 'EXTERNAL_HIGH' },
  ], permissions: {}, approval: [], allowExternalAuto: true, assumptions: [], sideEffects: {}, dataPolicy: {},
};

const slackEvent = (ts: string) => ({
  type: 'slack.new_message',
  payload: { messageId: ts, ts, channel: '#ops', channelId: 'C1', text: 'hello', sender: 'U1' },
});

async function setup() {
  const db = await createDatabaseAsync(':memory:');
  const store = new WorkflowStore(db);
  const { workflowId } = store.saveWorkflow(workflow);
  store.setWorkflowActive(workflowId, true);
  return { db, store, workflowId, ir: store.getWorkflow(workflowId)! };
}

describe('trigger receipt attempts', () => {
  it('backs off exponentially and dead-letters after the attempt cap', async () => {
    const { db, store, workflowId, ir } = await setup();
    const dedupeKey = `${workflowId}:slack.new_message:1.0`;
    try {
      let now = 1_000_000;
      for (let attempt = 1; attempt < MAX_TRIGGER_ATTEMPTS; attempt++) {
        expect(store.claimTriggerReceipt({ dedupeKey, workflowId, triggerType: 'slack.new_message' })).toBe(true);
        expect(recordTriggerFailure(store, { dedupeKey, workflowId, workflow: ir, reason: 'failed' }, now)).toBe('retry');
        expect(triggerRetryBlocked(store, dedupeKey, now + 1)).toBe(true);
        now += 60 * 60_000;
        expect(triggerRetryBlocked(store, dedupeKey, now)).toBe(false);
      }
      expect(store.claimTriggerReceipt({ dedupeKey, workflowId, triggerType: 'slack.new_message' })).toBe(true);
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      expect(recordTriggerFailure(store, { dedupeKey, workflowId, workflow: ir, reason: 'failed' }, now)).toBe('dead');
      error.mockRestore();
      expect(store.claimTriggerReceipt({ dedupeKey, workflowId, triggerType: 'slack.new_message' })).toBe(false);
      expect(store.getSetting(DEAD_LETTER_SETTING, [])).toEqual([
        expect.objectContaining({ dedupeKey, attempts: MAX_TRIGGER_ATTEMPTS, reason: 'max_attempts_exceeded' }),
      ]);
    } finally { db.close?.(); }
  });

  it('never retries a run whose external step already succeeded', async () => {
    const { db, store, workflowId, ir } = await setup();
    const dedupeKey = `${workflowId}:slack.new_message:2.0`;
    store.claimTriggerReceipt({ dedupeKey, workflowId, triggerType: 'slack.new_message' });
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      expect(recordTriggerFailure(store, { dedupeKey, workflowId, workflow: ir, reason: 'failed', result: {
        executionId: 'e1', status: 'failed', errorCode: 'output_contract_failed',
        log: [{ at: '', level: 'info', code: 'step_completed', message: '', data: { stepId: 'send', stepType: 'action' } }],
      } })).toBe('dead');
      expect(store.getSetting(DEAD_LETTER_SETTING, [])).toEqual([
        expect.objectContaining({ dedupeKey, attempts: 1, reason: 'external_effect_possible', executionId: 'e1' }),
      ]);
    } finally { error.mockRestore(); db.close?.(); }
  });
});

describe('push event delivery', () => {
  const driver = PUSH_TRIGGER_DRIVERS.find(({ triggerType }) => triggerType === 'slack.new_message')!;

  it('uses the same receipt key as the poll path and advances the poll cursor', async () => {
    const { db, store, workflowId } = await setup();
    store.setSetting('trigger.cursors', { [workflowId]: { initialized: true, lastMessageTs: '1.0' } });
    const executeWorkflow = vi.fn(async () => ({ status: 'success', executionId: 'e1', log: [] }));
    const coordinator = new TriggerEventCoordinator(store, { executeWorkflow } as never, () => true);
    try {
      const event = slackEvent('5.0');
      expect(driver.dedupeKey(workflowId, event)).toBe(eventDedupeKey(workflowId, event));
      expect(await coordinator.handlePushEvent(driver, event)).toBe(true);
      await coordinator.drain();
      expect(executeWorkflow).toHaveBeenCalledTimes(1);
      expect(store.isTriggerReceiptCompleted(eventDedupeKey(workflowId, event)!)).toBe(true);
      expect(store.getSetting<Record<string, { lastMessageTs?: string; seenMessageIds?: string[] }>>('trigger.cursors', {})[workflowId])
        .toMatchObject({ lastMessageTs: '5.0', seenMessageIds: ['5.0'] });
      expect(store.getSetting(PUSH_EVENT_JOURNAL_SETTING, null)).toEqual([]);
    } finally { db.close?.(); }
  });

  it('persists an accepted event before ACK and replays it after a restart', async () => {
    const { db, store } = await setup();
    const never = new Promise<never>(() => undefined);
    const stalled = new TriggerEventCoordinator(store, { executeWorkflow: vi.fn(() => never) } as never, () => true);
    // Fill every active slot so the next event stays queued, as if the app quit now.
    for (let index = 0; index < 16; index++) await stalled.handlePushEvent(driver, slackEvent(`${10 + index}.0`));
    expect(await stalled.handlePushEvent(driver, slackEvent('99.0'))).toBe(true);
    const journal = store.getSetting<Array<{ state: string; event: { payload: { ts: string } } }>>(PUSH_EVENT_JOURNAL_SETTING, []);
    expect(journal).toHaveLength(17);
    expect(journal.at(-1)).toMatchObject({ state: 'queued', event: { payload: { ts: '99.0' } } });

    const executeWorkflow = vi.fn(async () => ({ status: 'success', executionId: 'e2', log: [] }));
    const restarted = new TriggerEventCoordinator(store, { executeWorkflow } as never, () => true);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      // The 16 started events may have reached a side effect; only the queued one is replayed.
      expect(restarted.replayPendingEvents()).toBe(1);
      await restarted.drain();
      expect(executeWorkflow).toHaveBeenCalledTimes(1);
      expect(executeWorkflow).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
        input: expect.objectContaining({ ts: '99.0' }),
      }));
      expect(store.getSetting(PUSH_EVENT_JOURNAL_SETTING, null)).toEqual([]);
    } finally { warn.mockRestore(); db.close?.(); }
  });
});

describe('file event identity', () => {
  it('treats the same file dropped in again (new modification time) as a new event', async () => {
    const { eventDedupeKey } = await import('./helpers.js');
    const first = eventDedupeKey('wf', { type: 'local_folder.new_file', payload: { filePath: 'D:/in/report.xlsx', modifiedAt: '2026-10-01T09:00:00.000Z' } });
    const again = eventDedupeKey('wf', { type: 'local_folder.new_file', payload: { filePath: 'D:/in/report.xlsx', modifiedAt: '2026-11-01T09:00:00.000Z' } });
    const redelivered = eventDedupeKey('wf', { type: 'local_folder.new_file', payload: { filePath: 'D:/in/report.xlsx', modifiedAt: '2026-10-01T09:00:00.000Z' } });
    expect(again).not.toBe(first);
    expect(redelivered).toBe(first);
  });
});
