import { describe, expect, it } from 'vitest';
import { AgentHarness } from '../../../harness.js';
import type { StructuredGenerateInput, TextGenerateInput } from '../../../model/provider.js';
import { createDatabaseAsync } from '../../../../../persistence/db.js';
import { WorkflowStore } from '../../../../../persistence/workflow-store.js';
import { runAxCommandChat } from '../../chat.js';
import { AxCommandService } from '../../service.js';
import { scriptedModel } from '../fixtures.js';
import type { DecisionEngine } from '../../../../../contracts/decision.js';

describe('runAxCommandChat connection selection', () => {
  it('renders a host-owned endpoint choice for an explicit GET without exposing base URLs or calling a model', async () => {
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
    const structuredCalls: StructuredGenerateInput<unknown>[] = [];
    const textCalls: TextGenerateInput[] = [];

    const reply = await runAxCommandChat({
      harness: new AgentHarness(scriptedModel([], structuredCalls, 'test-provider', [], textCalls)),
      commandService: service,
      httpEndpoints: [
        { id: 'alpha-api', label: 'Alpha API', usable: true },
        { id: 'beta-api', label: 'Beta API', usable: true },
      ],
      messages: [],
      userMessage: 'GET /api/v1/orders?status=paid 를 조회해줘. 외부 데이터 변경은 하지 마.',
      onPresentation: (presentation) => presentations.push(presentation),
    });

    expect(reply).toContain('연결');
    expect(structuredCalls).toHaveLength(0);
    expect(textCalls).toHaveLength(0);
    expect(presentations).toMatchObject([{
      title: '어떤 연결에서 조회할까요?',
      inputs: [{
        id: 'http-endpoint-id',
        label: 'API 연결',
        options: [
          { label: 'Alpha API', value: 'alpha-api' },
          { label: 'Beta API', value: 'beta-api' },
        ],
      }],
      actions: [],
    }]);
    expect(JSON.stringify(presentations)).not.toContain('alpha.example.com');
    db.close();
  });

  it('does not add a chooser card when Jev classifies a connection inventory request', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    store.setConnection('http', true, {
      endpoints: [
        { id: 'github', label: '깃허브 연결', baseUrl: 'https://api.github.com/', authType: 'none' },
        { id: 'test', label: '테스트 HTTP 연결', baseUrl: 'http://127.0.0.1:4820/', authType: 'none' },
      ],
    });
    const presentations: import('../../schema.js').AxUiPresentation[] = [];
    const decisionEngine: DecisionEngine = {
      evaluate: async () => ({ answers: {
        route: { type: 'choice', choice: 'connection_list', probabilities: { connection_list: 0.98 }, confidence: 0.98 },
      } }),
    };
    const textCalls: TextGenerateInput[] = [];
    const harness = new AgentHarness(scriptedModel([], [], 'test-provider', [], textCalls));

    const reply = await runAxCommandChat({
      harness,
      commandService: new AxCommandService(store),
      decisionEngine,
      messages: [],
      userMessage: '저장된 HTTP 연결을 모두 목록으로 보여줘.',
      onPresentation: (presentation) => presentations.push(presentation),
    });

    expect(presentations).toEqual([]);
    expect(reply).toContain('저장된 HTTP 연결 (2/2개)');
    expect(reply).toContain('깃허브 연결');
    expect(reply).toContain('테스트 HTTP 연결');
    expect(textCalls).toHaveLength(0);
    db.close();
  });
});
