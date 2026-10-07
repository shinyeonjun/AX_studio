import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../../persistence/db.js';
import { WorkflowStore } from '../../persistence/workflow-store.js';
import { encodeScheduleInputValue } from '../../workflow/schedule/input-value.js';
import { buildDiscoveryBlueprint } from '../compile/blueprint.js';
import { WorkDiscoveryService } from '../service.js';
import { makeSession } from './fixtures.js';

const recurrence = {
  kind: 'recurrence' as const, freq: 'monthly' as const, interval: 1, byMonthDay: [1],
  times: [{ hour: 9, minute: 0 }], anchor: '2026-10-07', timezone: 'Asia/Seoul',
};

async function readyService(id: string) {
  const db = await createDatabaseAsync(':memory:');
  const store = new WorkflowStore(db);
  const service = new WorkDiscoveryService({ store, snapshotDir: join(mkdtempSync(join(tmpdir(), 'ax-discovery-schedule-')), 'snapshots') });
  const base = makeSession(id, { status: 'ready_to_publish', pendingQuestion: undefined, humanConfirmedAt: new Date().toISOString() });
  store.saveDiscoverySession({ ...base, blueprint: buildDiscoveryBlueprint(base) });
  return { store, service, close: () => db.close?.() };
}

describe('handing over a learned work', () => {
  it('repeats on the schedule picked while handing it over', async () => {
    const { store, service, close } = await readyService('wd_publish_schedule');
    const published = service.publish('wd_publish_schedule', '매출 보고', undefined, encodeScheduleInputValue(recurrence));
    expect('workflowId' in published && store.getWorkflow(published.workflowId)?.trigger)
      .toEqual({ type: 'schedule', recurrence, timezone: 'Asia/Seoul' });
    close();
  });

  it('saves nothing when the schedule cannot be read', async () => {
    const { store, service, close } = await readyService('wd_publish_bad_schedule');
    expect(service.publish('wd_publish_bad_schedule', '매출 보고', undefined, '매월 1일 ⟦일정:e30⟧')).toEqual({ error: 'invalid_schedule' });
    expect(store.listWorkflows()).toHaveLength(0);
    close();
  });
});
