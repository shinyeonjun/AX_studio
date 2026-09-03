import { describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../../../store/db.js';
import { WorkflowStore } from '../../../store/workflow-store.js';
import { WorkflowRuntime } from '../../engine.js';
import { createTestConnectors, mockGmail, mockSlack } from '../../../modules/test-connectors.js';
import { TriggerEngine } from '../../trigger-engine.js';
import { gmailNotifySkill } from './fixtures.js';

describe('TriggerEngine polling cursor recovery', () => {
  it.each([
    ['a null cursor store', null],
    ['an array cursor store', []],
  ])('rebuilds polling state from %s', async (_label, corruptedCursors) => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const runtime = new WorkflowRuntime({
      store,
      globalActive: true,
      workflowActive: {},
      connectors: createTestConnectors(),
    });
    mockGmail(runtime.connectors).messages.push({
      id: 'msg-existing',
      from: 'old@example.com',
      subject: '기존 메일',
      body: 'already here',
    });
    const { workflowId } = store.saveWorkflow(gmailNotifySkill);
    store.setWorkflowActive(workflowId, true);
    store.setSetting('trigger.cursors', corruptedCursors);

    await new TriggerEngine(store, runtime).tick();

    expect(mockSlack(runtime.connectors).messages).toHaveLength(0);
    expect(store.getSetting<Record<string, unknown>>('trigger.cursors', {})[workflowId]).toMatchObject({
      initialized: true,
      seenMessageIds: ['msg-existing'],
    });
  });

  it('rebuilds a malformed workflow cursor without discarding valid cursors', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const runtime = new WorkflowRuntime({
      store,
      globalActive: true,
      workflowActive: {},
      connectors: createTestConnectors(),
    });
    const { workflowId } = store.saveWorkflow(gmailNotifySkill);
    store.setWorkflowActive(workflowId, true);
    store.setSetting('trigger.cursors', {
      [workflowId]: { initialized: true, seenMessageIds: 'not-an-array' },
      'other-workflow': { initialized: true, seenMessageIds: ['msg-valid'] },
    });

    await new TriggerEngine(store, runtime).tick();

    expect(store.getSetting<Record<string, unknown>>('trigger.cursors', {})).toMatchObject({
      [workflowId]: { initialized: true, seenMessageIds: [] },
      'other-workflow': { initialized: true, seenMessageIds: ['msg-valid'] },
    });
  });
});
