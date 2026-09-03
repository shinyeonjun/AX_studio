import { describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../../../store/db.js';
import { WorkflowStore } from '../../../store/workflow-store.js';
import { WorkflowRuntime } from '../../engine.js';
import { createTestConnectors, mockGmail, mockSlack } from '../../../modules/test-connectors.js';
import { TriggerEngine } from '../../trigger-engine.js';
import type { WorkflowIR } from '../../../workflow/schema.js';
import { gmailNotifySkill } from './fixtures.js';

describe('TriggerEngine polling eligibility', () => {
  it('filters event payloads before executing downstream steps', async () => {
    const filteredWorkflow: WorkflowIR = {
      ...gmailNotifySkill,
      name: '발신자 필터 알림',
      trigger: {
        type: 'gmail.new_message',
        accountId: 'primary',
        filter: {
          op: 'eq',
          left: { ref: 'from' },
          right: { lit: 'sender@example.com' },
        },
      },
    };
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const runtime = new WorkflowRuntime({ store, globalActive: true, workflowActive: {}, connectors: createTestConnectors() });
    const { workflowId } = store.saveWorkflow(filteredWorkflow);
    store.setWorkflowActive(workflowId, true);
    const engine = new TriggerEngine(store, runtime);

    await engine.tick();
    mockGmail(runtime.connectors).messages.push(
      { id: 'msg-other', from: 'other@example.com', subject: '무시', body: '무시' },
      { id: 'msg-match', from: 'sender@example.com', subject: '처리', body: '처리' },
    );

    await engine.tick();

    expect(mockSlack(runtime.connectors).messages).toHaveLength(1);
    expect(mockSlack(runtime.connectors).messages[0]?.text).toBe('new mail');
  });

  it('does not poll inactive works', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const runtime = new WorkflowRuntime({ store, globalActive: true, workflowActive: {}, connectors: createTestConnectors() });
    const { workflowId } = store.saveWorkflow(gmailNotifySkill);
    store.setWorkflowActive(workflowId, false);

    const engine = new TriggerEngine(store, runtime);
    await engine.tick();

    mockGmail(runtime.connectors).messages.push({
      id: 'msg-new',
      from: 'a@b.com',
      subject: 'test',
      body: 'body',
    });
    await engine.tick();
    expect(mockSlack(runtime.connectors).messages).toHaveLength(0);
  });
});
