import { describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../../../../store/db.js';
import { WorkflowStore } from '../../../../store/workflow-store.js';
import { AxCommandService } from '../../service.js';
import { commandChatContext } from '../fixtures.js';

describe('AxCommandService one-shot queue', () => {
  it('returns one typed target card before queueing a one-shot external share', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    store.setConnection('http', true, {
      endpoints: [
        { id: 'test', label: '테스트 HTTP 연결', baseUrl: 'http://127.0.0.1:4820/', authType: 'none' },
        { id: 'github', label: '깃허브 연결', baseUrl: 'https://api.github.com/', authType: 'none' },
      ],
    });
    store.setConnection('slack', true);
    const queued: unknown[] = [];
    const service = new AxCommandService(store, {
      enqueueOnce: (workflow) => {
        queued.push(workflow);
        return { jobId: 'job-1' };
      },
      readGateway: {
        execute: async () => ({
          tool: 'capabilities.invoke',
          ok: true,
          data: { data: { channels: [{ id: 'C_OPERATIONS', name: '운영' }] } },
        }),
      },
    });

    const response = await service.execute({
      name: 'execution.enqueue_once',
      args: {
        name: '결제 주문 공유',
        goal: '결제 완료 주문을 요약해 Slack으로 공유한다',
        steps: [
          {
            type: 'action',
            id: 'fetch',
            connector: 'http',
            action: 'request',
            params: { method: 'GET', path: '/api/v1/orders?status=paid' },
          },
          {
            type: 'action',
            id: 'notify',
            connector: 'slack',
            action: 'message.send',
            params: { text: '결제 완료 주문 요약' },
          },
        ],
      },
    }, {
      ...commandChatContext,
      designToolContext: {
        connections: store.getConnections(),
        connectedConnectorIds: ['http', 'slack'],
        connectors: {},
      },
    });

    expect(response).toMatchObject({
      command: 'execution.enqueue_once',
      status: 'needs_input',
      data: {
        queued: false,
        pending: true,
        presentation: {
          title: '공유 대상 선택',
          inputs: [
            {
              id: 'execution-http-connection',
              options: [
                { value: 'test', label: '테스트 HTTP 연결' },
                { value: 'github', label: '깃허브 연결' },
              ],
            },
            { id: 'execution-slack-channel', options: [{ value: 'C_OPERATIONS', label: '#운영' }] },
          ],
          actions: [{ id: 'review_execution_targets' }],
        },
      },
    });
    expect(queued).toHaveLength(0);
  });
});
