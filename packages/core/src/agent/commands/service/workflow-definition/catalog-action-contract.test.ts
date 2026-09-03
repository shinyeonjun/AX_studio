import { describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../../../../store/db.js';
import { WorkflowStore } from '../../../../store/workflow-store.js';
import { AxCommandService } from '../../service.js';
import { commandChatContext } from '../fixtures.js';

describe('AxCommandService catalog action contract', () => {
  it('lets the catalog provide actionRef and sideEffect instead of trusting model fields', async () => {
    const db = await createDatabaseAsync(':memory:');
    const service = new AxCommandService(new WorkflowStore(db));

    const response = await service.execute({
      name: 'workflow.create',
      args: {
        name: '계약 테스트',
        goal: 'catalog 계약으로 만든다',
        steps: [
          {
            type: 'action',
            id: 'notify',
            connector: 'slack',
            action: 'send_message',
            params: { channel: '#ops', text: 'hello' },
          },
        ],
      },
    }, commandChatContext);

    expect(response.status).toBe('ok');
    expect(response.data).toMatchObject({
      workflow: {
        steps: [
          {
            action: 'message.send',
            actionRef: 'slack.message.send@1',
            sideEffect: 'EXTERNAL',
          },
        ],
      },
    });
  });
});
