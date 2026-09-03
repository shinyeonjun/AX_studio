import { describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../../../../store/db.js';
import { WorkflowStore } from '../../../../store/workflow-store.js';
import { AxCommandService } from '../../service.js';
import { commandChatContext } from '../fixtures.js';

describe('AxCommandService HTTP write contract', () => {
  it('normalizes HTTP POST as an approved write step', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    store.setConnection('http', true, { baseUrl: 'https://api.example.com/v1/' });
    const service = new AxCommandService(store);

    const response = await service.execute({
      name: 'workflow.create',
      args: {
        name: 'POST 계약 테스트',
        goal: '외부 API에 검증 payload를 보낸다',
        steps: [
          {
            type: 'action',
            id: 'create_ticket',
            connector: 'http',
            action: 'post',
            params: { path: 'tickets', body: { title: '검증', priority: 'critical' } },
          },
        ],
      },
    }, commandChatContext);

    expect(response).toMatchObject({
      status: 'ok',
      data: {
        workflow: {
          steps: [{ action: 'post', actionRef: 'http.post@1', sideEffect: 'EXTERNAL' }],
        },
      },
    });
  });
});
