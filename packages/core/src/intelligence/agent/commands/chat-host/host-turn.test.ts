import { describe, expect, it } from 'vitest';
import { buildHttpResponseArtifact } from '../../../../contracts/artifacts/http-response.js';
import type { DecisionEngine, DecisionEvaluationResult } from '../../../../contracts/decision.js';
import { createDatabaseAsync } from '../../../../persistence/db.js';
import type { WorkspaceChatMessage } from '../../../../persistence/repositories/workspace-chat/contracts.js';
import { WorkflowStore } from '../../../../persistence/workflow-store.js';
import { AgentHarness } from '../../harness.js';
import { runAxCommandChat } from '../chat.js';
import { scriptedModel } from '../chat/testing/fixtures.js';
import { AxCommandService } from '../service.js';
import { hostReadRecipeFor, hostReadResultFor, rememberHostReadResult } from './host-state.js';
import { chatTurnCallbacks, emptyChatTurnState } from './turn-state.js';

/**
 * One host's view of two chat turns, with no desktop around it: a read shown as a table, then
 * "이 중 …" answered from that same table without reading again.
 */
describe('a host running chat turns with what it keeps between them', () => {
  it('answers a follow-up from the table it showed and remembers how that table was made', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    store.setConnection('http', true, { endpoints: [{ id: 'shop', label: '쇼핑몰 API', baseUrl: 'https://shop.example.com/', authType: 'none' }] });
    const response = buildHttpResponseArtifact({
      executionId: 'host-turn', url: 'https://shop.example.com/products', status: 200, statusText: 'OK',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ products: [{ title: 'First', stock: 20 }, { title: 'Second', stock: 50 }] }),
      truncated: false,
    });
    let reads = 0;
    const commandService = new AxCommandService(store, { readGateway: { execute: async () => {
      reads += 1;
      return { tool: 'capabilities.invoke', ok: true, data: { capabilityId: 'http.request', data: response, citations: [], untrusted: true } };
    } } });
    const pick = (question: unknown, match: (criterion: Record<string, unknown>) => boolean) =>
      Object.entries((question as { criteria?: Record<string, unknown> } | undefined)?.criteria ?? {})
        .find(([, criterion]) => typeof criterion === 'object' && criterion !== null && match(criterion as Record<string, unknown>))?.[0] ?? 'none';
    const choice = (value: string) => ({ type: 'choice' as const, choice: value, probabilities: { [value]: 0.99 }, confidence: 0.99 });
    const decisionEngine: DecisionEngine = {
      evaluate: async ({ questions }): Promise<DecisionEvaluationResult> => {
        if (questions.route) {
          const followUp = questions.route.type === 'choice' && Object.hasOwn(questions.route.criteria, 'previous_result');
          return { answers: { route: choice(followUp ? 'previous_result' : 'http_read'), ...(followUp ? {} : { table_transform: choice('none') }) } };
        }
        return { answers: {
          table_transform: choice('filter'),
          filter_column: choice(pick(questions.filter_column, (criterion) => criterion.field === 'stock')),
          filter_operator: choice('lt'),
          filter_value: choice(pick(questions.filter_value, (criterion) => criterion.value === 30)),
        } };
      },
    };
    const sessionId = store.saveWorkspaceChat({ messages: [] }).id;
    const harness = new AgentHarness(scriptedModel([], [], 'test-provider'));
    const turn = async (userMessage: string, messages: WorkspaceChatMessage[]) => {
      const state = emptyChatTurnState();
      const reply = await runAxCommandChat({
        harness, commandService, decisionEngine, workspaceSessionId: sessionId,
        connectedConnectors: ['http'], httpEndpoints: [{ id: 'shop', label: '쇼핑몰 API', usable: true }],
        messages: messages.map(({ role, content }) => ({ role, content })), userMessage,
        previousReadResult: hostReadResultFor(store, sessionId, messages),
        previousReadRecipe: hostReadRecipeFor(store, sessionId, messages),
        ...chatTurnCallbacks(state, { sessionId, userMessage, claim: undefined }),
      });
      const shown = state.readResultReported ? rememberHostReadResult(store, sessionId, state.readResult, state.readRecipe) : undefined;
      return { reply, shown };
    };

    const first = await turn('쇼핑몰 API에서 GET products 조회해서 보여줘', []);
    expect(reads).toBe(1);
    expect(first.shown?.rows).toHaveLength(2);

    const transcript: WorkspaceChatMessage[] = [
      { role: 'user', content: '쇼핑몰 API에서 GET products 조회해서 보여줘' },
      { role: 'assistant', content: first.reply, readResult: first.shown },
      { role: 'user', content: '이 중 재고 30 미만만' },
    ];
    const second = await turn('이 중 재고 30 미만만', transcript);
    expect(reads).toBe(1);
    expect(second.shown?.rows.map((row) => row.values.title)).toEqual(['First']);
    expect(hostReadRecipeFor(store, sessionId, [...transcript, { role: 'assistant', content: second.reply, readResult: second.shown }]))
      .toMatchObject({ kind: 'http_table', expression: expect.anything() });
    db.close?.();
  });
});
