import { describe, expect, it } from 'vitest';
import { AgentHarness } from '../../../harness.js';
import type { StructuredGenerateInput } from '../../../model/provider.js';
import { createDatabaseAsync } from '../../../../store/db.js';
import { WorkflowStore } from '../../../../store/workflow-store.js';
import { runAxCommandChat } from '../../chat.js';
import { AxCommandService } from '../../service.js';
import { scriptedModel } from '../fixtures.js';

describe('runAxCommandChat connection selection', () => {
  it('uses the selected chooser action as an explicit connection on the next turn', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    store.setConnection('http', true, {
      endpoints: [
        { id: 'github', label: '깃허브 연결', baseUrl: 'https://api.github.com/', authType: 'none' },
        { id: 'test', label: '테스트 HTTP 연결', baseUrl: 'http://127.0.0.1:4820/', authType: 'none' },
      ],
    });
    const seen: StructuredGenerateInput<unknown>[] = [];
    const readCalls: Array<{ args: Record<string, unknown> }> = [];
    const service = new AxCommandService(store, {
      readGateway: {
        execute: async (request) => {
          readCalls.push({ args: request.args });
          return { tool: 'capabilities.invoke', ok: true, data: { status: 200, body: '[]' } };
        },
      },
    });
    const firstPresentations: import('../../schema.js').AxUiPresentation[] = [];
    await runAxCommandChat({
      harness: new AgentHarness(scriptedModel([
        { kind: 'command', command: { name: 'http.list', args: {} } },
        {
          kind: 'command',
          command: {
            name: 'ui.present',
            args: {
              title: 'HTTP 연결 선택',
              actions: [
                { id: 'github', label: '깃허브 연결', value: 'HTTP 연결 ID github를 사용해줘' },
                { id: 'test', label: '테스트 HTTP 연결', value: 'HTTP 연결 ID test를 사용해줘' },
              ],
            },
          },
        },
        { kind: 'reply', message: '연결을 선택해 주세요.' },
      ], [])),
      commandService: service,
      messages: [],
      userMessage: 'GET /api/v1/orders?status=paid 를 조회해줘.',
      onPresentation: (presentation) => firstPresentations.push(presentation),
    });
    const selected = firstPresentations[0]?.actions.find((action) => action.label === '테스트 HTTP 연결');
    expect(selected?.value).toBe('HTTP 연결 ID test를 사용해줘');

    await runAxCommandChat({
      harness: new AgentHarness(scriptedModel([
        { kind: 'command', command: { name: 'capability.invoke', args: {
          id: 'http.request',
          params: { method: 'GET', path: '/api/v1/orders?status=paid', connectionId: 'test' },
        } } },
        { kind: 'reply', message: '테스트 HTTP 연결로 조회했습니다.' },
      ], seen)),
      commandService: service,
      messages: [
        { role: 'user', content: 'GET /api/v1/orders?status=paid 를 조회해줘.' },
        { role: 'assistant', content: '조회할 연결을 선택해 주세요.' },
      ],
      userMessage: selected!.value,
    });

    expect(readCalls).toEqual([{
      args: {
        id: 'http.request',
        params: { method: 'GET', path: '/api/v1/orders?status=paid', connectionId: 'test' },
      },
    }]);
  });
});
