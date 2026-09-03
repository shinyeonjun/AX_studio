import { describe, expect, it } from 'vitest';
import { AgentHarness } from '../../../harness.js';
import type { StructuredGenerateInput } from '../../../model/provider.js';
import { createDatabaseAsync } from '../../../../store/db.js';
import { WorkflowStore } from '../../../../store/workflow-store.js';
import { runAxCommandChat } from '../../chat.js';
import { AxCommandService } from '../../service.js';
import { scriptedModel } from '../fixtures.js';

describe('runAxCommandChat connection selection', () => {
  it('keeps dynamic HTTP selection inside the command and presentation protocol', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    store.setConnection('http', true, {
      endpoints: [
        { id: 'alpha-api', label: 'Alpha API', baseUrl: 'https://alpha.example.com/', authType: 'none' },
        { id: 'beta-api', label: 'Beta API', baseUrl: 'https://beta.example.com/', authType: 'none' },
      ],
    });
    const service = new AxCommandService(store);
    const presentations: import('../../schema.js').AxUiPresentation[] = [];
    const seen: StructuredGenerateInput<unknown>[] = [];
    const harness = new AgentHarness(
      scriptedModel([
        { kind: 'command', command: { name: 'http.list', args: {} } },
        {
          kind: 'command',
          command: {
            name: 'ui.present',
            args: {
              title: 'HTTP 연결 선택',
              subtitle: '조회할 연결을 선택해 주세요.',
              blocks: [{ type: 'steps', items: ['Alpha API (alpha-api)', 'Beta API (beta-api)'] }],
              actions: [
                { id: 'alpha', label: 'Alpha API', value: 'HTTP 연결 ID alpha-api를 사용해줘' },
                { id: 'beta', label: 'Beta API', value: 'HTTP 연결 ID beta-api를 사용해줘' },
              ],
            },
          },
        },
        { kind: 'reply', message: '조회할 연결을 선택해 주세요.' },
      ], seen),
    );

    const reply = await runAxCommandChat({
      harness,
      commandService: service,
      messages: [],
      userMessage: 'GET /api/v1/orders?status=paid 를 조회해줘. 외부 데이터 변경은 하지 마.',
      onPresentation: (presentation) => presentations.push(presentation),
    });

    expect(reply).toContain('연결');
    expect(seen).toHaveLength(3);
    expect(seen[1]?.messages?.some((message) => message.content.includes('"http.list"'))).toBe(true);
    expect(presentations).toHaveLength(1);
    expect(presentations[0]).toMatchObject({
      title: 'HTTP 연결 선택',
      actions: [
        { label: 'Alpha API', value: 'HTTP 연결 ID alpha-api를 사용해줘' },
        { label: 'Beta API', value: 'HTTP 연결 ID beta-api를 사용해줘' },
      ],
    });
    expect(JSON.stringify(presentations)).not.toContain('alpha.example.com');
  });

  it('does not add a chooser card when the user only asks to inspect connections', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    store.setConnection('http', true, {
      endpoints: [
        { id: 'github', label: '깃허브 연결', baseUrl: 'https://api.github.com/', authType: 'none' },
        { id: 'test', label: '테스트 HTTP 연결', baseUrl: 'http://127.0.0.1:4820/', authType: 'none' },
      ],
    });
    const presentations: import('../../schema.js').AxUiPresentation[] = [];
    const harness = new AgentHarness(
      scriptedModel([
        { kind: 'command', command: { name: 'http.list', args: {} } },
        { kind: 'reply', message: '저장된 HTTP 연결 2개를 확인했습니다.' },
      ], []),
    );

    await runAxCommandChat({
      harness,
      commandService: new AxCommandService(store),
      messages: [],
      userMessage: '저장된 HTTP 연결을 모두 목록으로 보여줘.',
      onPresentation: (presentation) => presentations.push(presentation),
    });

    expect(presentations).toEqual([]);
  });
});
