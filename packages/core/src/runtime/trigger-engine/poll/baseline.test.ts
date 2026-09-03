import { describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../../../store/db.js';
import { WorkflowStore } from '../../../store/workflow-store.js';
import { WorkflowRuntime } from '../../engine.js';
import { createTestConnectors, mockGmail, mockSlack } from '../../../modules/test-connectors.js';
import { TriggerEngine } from '../../trigger-engine.js';
import { gmailNotifySkill } from './fixtures.js';

describe('TriggerEngine polling baseline', () => {
  it('baselines on first poll and fires once for each new gmail message', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const runtime = new WorkflowRuntime({ store, globalActive: true, workflowActive: {}, connectors: createTestConnectors() });
    mockGmail(runtime.connectors).messages.push({
      id: 'msg-existing',
      from: 'old@example.com',
      subject: '기존 메일',
      body: 'already here',
    });

    const { workflowId } = store.saveWorkflow(gmailNotifySkill);
    store.setWorkflowActive(workflowId, true);

    const engine = new TriggerEngine(store, runtime);

    await engine.tick();
    expect(mockSlack(runtime.connectors).messages).toHaveLength(0);

    mockGmail(runtime.connectors).messages.push({
      id: 'msg-new',
      from: 'plosind@naver.com',
      subject: '새 문의',
      body: '내용',
    });

    await engine.tick();
    expect(mockSlack(runtime.connectors).messages).toHaveLength(1);
    expect(mockSlack(runtime.connectors).messages[0]?.channel).toBe('#inbox');

    await engine.tick();
    expect(mockSlack(runtime.connectors).messages).toHaveLength(1);
  });
});
