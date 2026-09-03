import { describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../../store/db.js';
import { createTestConnectors, mockGmail, mockSlack } from '../../modules/test-connectors.js';
import { WorkflowStore } from '../../store/workflow-store.js';
import { csMailWorkflowFixture } from '../../testing/fixtures/workflows.js';
import { WorkflowRuntime } from '../../runtime/engine.js';

describe('Runtime', () => {
  it('runs a valid CS notification flow', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const runtime = new WorkflowRuntime({ store, globalActive: true, workflowActive: {}, connectors: createTestConnectors() });
    mockGmail(runtime.connectors).messages.push({
      id: '1',
      from: 'customer@example.com',
      subject: '환불 요청',
      body: '결제가 두 번 됐습니다',
    });

    const ir = {
      ...csMailWorkflowFixture,
      trigger: { type: 'manual' as const },
      steps: [
        {
          type: 'action' as const,
          id: 'notify_support',
          connector: 'slack',
          action: 'message.send',
          params: { channel: '#support', text: '새 고객 문의가 도착했습니다.' },
          sideEffect: 'EXTERNAL' as const,
        },
      ],
    };
    const result = await runtime.executeWorkflow(ir, {
      ephemeral: true,
      input: { emailBody: mockGmail(runtime.connectors).messages[0].body },
    });
    expect(result.status).toBe('success');
    expect(mockSlack(runtime.connectors).messages.length).toBeGreaterThan(0);
  });
});
