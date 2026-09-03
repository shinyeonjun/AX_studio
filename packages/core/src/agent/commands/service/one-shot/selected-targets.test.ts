import { describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../../../../store/db.js';
import { WorkflowStore } from '../../../../store/workflow-store.js';
import { AxCommandService } from '../../service.js';
import { commandChatContext } from '../fixtures.js';
import type { WorkflowIR } from '../../../../workflow/schema.js';

describe('AxCommandService one-shot queue', () => {
  it('queues the selected one-shot targets with the originating chat session', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    store.setConnection('http', true, {
      endpoints: [
        { id: 'test', label: '테스트 HTTP 연결', baseUrl: 'http://127.0.0.1:4820/', authType: 'none' },
        { id: 'github', label: '깃허브 연결', baseUrl: 'https://api.github.com/', authType: 'none' },
      ],
    });
    store.setConnection('slack', true);
    const queued: Array<{ workflow: WorkflowIR; sessionId?: string }> = [];
    const service = new AxCommandService(store, {
      enqueueOnce: (workflow, options) => {
        queued.push({ workflow, sessionId: options?.workspaceSessionId });
        return { jobId: 'job-2' };
      },
    });

    const response = await service.execute({
      name: 'execution.enqueue_once',
      args: {
        name: '선택된 주문 공유',
        goal: '선택된 연결과 채널로 한 번 공유한다',
        steps: [
          {
            type: 'action',
            id: 'fetch',
            connector: 'http',
            action: 'request',
            params: {
              method: 'GET',
              connectionId: 'test',
              path: '/api/v1/orders?status=paid',
            },
          },
          {
            type: 'action',
            id: 'notify',
            connector: 'slack',
            action: 'message.send',
            params: { channel: 'C_OPERATIONS', text: '결제 완료 주문 요약' },
          },
        ],
      },
    }, {
      ...commandChatContext,
      workspaceSessionId: 'chat-1',
    });

    expect(response).toMatchObject({
      command: 'execution.enqueue_once',
      status: 'queued',
      data: { queued: true, ephemeral: true, jobId: 'job-2' },
    });
    expect(queued).toHaveLength(1);
    expect(queued[0]?.sessionId).toBe('chat-1');
    expect(queued[0]?.workflow.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'fetch', params: expect.objectContaining({ connectionId: 'test' }) }),
      expect.objectContaining({ id: 'notify', params: expect.objectContaining({ channel: 'C_OPERATIONS' }) }),
    ]));
  });
});
