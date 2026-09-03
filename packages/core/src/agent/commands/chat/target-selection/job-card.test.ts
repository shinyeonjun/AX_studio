import { describe, expect, it } from 'vitest';
import { AgentHarness } from '../../../harness.js';
import type { StructuredGenerateInput } from '../../../model/provider.js';
import { createDatabaseAsync } from '../../../../store/db.js';
import { WorkflowStore } from '../../../../store/workflow-store.js';
import { runAxCommandChat } from '../../chat.js';
import { AxCommandService } from '../../service.js';
import { scriptedModel } from '../fixtures.js';

describe('runAxCommandChat target selection', () => {
  it('publishes a structured target card when a job needs HTTP and Slack selections', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    store.setConnection('http', true, {
      endpoints: [
        { id: 'test', label: '테스트 HTTP 연결', baseUrl: 'http://127.0.0.1:4820/', authType: 'none' },
        { id: 'github', label: '깃허브 연결', baseUrl: 'https://api.github.com/', authType: 'none' },
      ],
    });
    store.setConnection('slack', true);
    const chat = store.saveWorkspaceChat({ messages: [] });
    const service = new AxCommandService(store, {
      readGateway: {
        execute: async () => ({
          tool: 'capabilities.invoke',
          ok: true,
          data: { data: { channels: [{ id: 'C_OPERATIONS', name: '운영' }] } },
        }),
      },
    });
    const presentations: import('../../schema.js').AxUiPresentation[] = [];
    const seen: StructuredGenerateInput<unknown>[] = [];

    const reply = await runAxCommandChat({
      harness: new AgentHarness(scriptedModel([{
        kind: 'command',
        command: {
          name: 'job.propose',
          args: {
            name: '결제 주문 공유',
            goal: '결제 완료 주문을 요약해 공유한다',
            fetch: { method: 'GET', path: '/api/v1/orders?status=paid' },
            notify: { connector: 'slack' },
          },
        },
      }], seen)),
      commandService: service,
      messages: [],
      userMessage: '결제 완료 주문을 정리해서 팀에 공유해줘',
      workspaceSessionId: chat.id,
      designToolContext: { connections: [], connectedConnectorIds: ['http', 'slack'], connectors: {} },
      onPresentation: (presentation) => presentations.push(presentation),
    });

    expect(reply).toContain('HTTP 연결과 Slack 채널');
    expect(seen).toHaveLength(1);
    expect(presentations).toHaveLength(1);
    expect(presentations[0]).toMatchObject({
      title: '공유 대상 선택',
      inputs: [
        {
          id: 'job-http-connection',
          options: [
            { value: 'test', label: '테스트 HTTP 연결' },
            { value: 'github', label: '깃허브 연결' },
          ],
        },
        { id: 'job-slack-channel', options: [{ value: 'C_OPERATIONS', label: '#운영' }] },
      ],
      actions: [{ label: '선택하고 공유안 검토' }],
    });
  });
});
