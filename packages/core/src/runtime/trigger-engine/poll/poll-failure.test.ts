import { describe, expect, it, vi } from 'vitest';
import { createDatabaseAsync } from '../../../persistence/db.js';
import { WorkflowStore } from '../../../persistence/workflow-store.js';
import { WorkflowRuntime } from '../../engine.js';
import { createTestConnectors, mockGmail } from '../../../testing/connectors/test-connectors.js';
import { TriggerEngine } from '../../trigger-engine.js';
import { TRIGGER_POLL_FAILURE_PREFIX, type TriggerPollFailure } from './workflow.js';
import { gmailNotifySkill } from './fixtures.js';

describe('a "새 메일이 오면" check that keeps failing', () => {
  it('is recorded with why, in words, and forgotten once a check succeeds', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const runtime = new WorkflowRuntime({ store, globalActive: true, connectors: createTestConnectors() });
    const gmail = mockGmail(runtime.connectors);
    let loginExpired = true;
    runtime.connectors.gmail = {
      name: gmail.name,
      async execute(action, params, ctx) {
        if (action === 'new_message.poll' && loginExpired) return { ok: false, error: 'oauth_refresh_failed', errorCode: 'oauth_refresh_failed' };
        return gmail.execute(action, params, ctx);
      },
    };
    const { workflowId } = store.saveWorkflow(gmailNotifySkill);
    store.setWorkflowActive(workflowId, true);
    const engine = new TriggerEngine(store, runtime);
    const key = `${TRIGGER_POLL_FAILURE_PREFIX}${encodeURIComponent(workflowId)}`;

    await engine.tick();
    await engine.tick();
    const failure = store.getSetting<TriggerPollFailure | undefined>(key, undefined);
    expect(failure).toMatchObject({ code: 'oauth_refresh_failed', message: expect.stringContaining('Gmail을 다시 연결') });
    expect(Date.parse(failure!.lastFailedAt)).toBeGreaterThanOrEqual(Date.parse(failure!.firstFailedAt));

    loginExpired = false;
    await engine.tick();
    expect(store.getSetting(key, undefined)).toBeUndefined();

    // Deleting the job forgets its record too.
    loginExpired = true;
    await engine.tick();
    store.deleteWorkflow(workflowId);
    expect(store.getSetting(key, undefined)).toBeUndefined();
    db.close?.();
  });
});
