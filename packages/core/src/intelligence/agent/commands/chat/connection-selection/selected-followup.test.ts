import { describe, expect, it, vi } from 'vitest';
import { AgentHarness } from '../../../harness.js';
import type { StructuredGenerateInput, TextGenerateInput } from '../../../model/provider.js';
import { createDatabaseAsync } from '../../../../../persistence/db.js';
import { WorkflowStore } from '../../../../../persistence/workflow-store.js';
import { runAxCommandChat } from '../../chat.js';
import { AxCommandService } from '../../service.js';
import { scriptedModel } from '../fixtures.js';
import type { DecisionEngine } from '../../../../../contracts/decision.js';
import { buildHttpResponseArtifact } from '../../../../../contracts/artifacts/http-response.js';

describe('runAxCommandChat connection selection', () => {
  it('uses the selected endpoint input as an explicit connection on the next turn', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    store.setConnection('http', true, {
      endpoints: [
        { id: 'api-1', label: 'Short ID', baseUrl: 'https://short.example.com/', authType: 'none' },
        { id: 'api-10', label: 'Long ID', baseUrl: 'https://long.example.com/', authType: 'none' },
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
    const decisionEngine: DecisionEngine = {
      evaluate: async () => ({
        answers: {
          route: {
            type: 'choice',
            choice: 'http_read',
            probabilities: { http_read: 0.98, answer: 0.02 },
            confidence: 0.98,
          },
        },
      }),
    };
    await runAxCommandChat({
      harness: new AgentHarness(scriptedModel([], seen)),
      commandService: service,
      messages: [],
      userMessage: 'GET /api/v1/orders?status=paid 를 조회해줘.',
      httpEndpoints: [
        { id: 'api-1', label: 'Short ID', usable: true },
        { id: 'api-10', label: 'Long ID', usable: true },
      ],
      onPresentation: (presentation) => firstPresentations.push(presentation),
    });
    const selected = firstPresentations[0]?.inputs[0]?.options?.find((option) => option.label === 'Long ID');
    expect(selected?.value).toBe('api-10');
    expect(seen).toHaveLength(0);

    await runAxCommandChat({
      harness: new AgentHarness(scriptedModel([], seen)),
      commandService: service,
      decisionEngine,
      connectedConnectors: ['http'],
      httpEndpoints: [
        { id: 'api-1', label: 'Short ID', usable: true },
        { id: 'api-10', label: 'Long ID', usable: true },
      ],
      messages: [
        { role: 'user', content: 'GET /api/v1/orders?status=paid 를 조회해줘.' },
        { role: 'assistant', content: '조회할 연결을 선택해 주세요.' },
      ],
      userMessage: `HTTP 연결 ID: ${selected!.value}`,
    });

    expect(readCalls).toEqual([{
      args: {
        id: 'http.request',
        params: { method: 'GET', path: '/api/v1/orders?status=paid', connectionId: 'api-10' },
      },
    }]);
  });

  it('uses the original request intent after the user selects an HTTP connection', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const response = buildHttpResponseArtifact({
      executionId: 'selected-http-table',
      url: 'https://dummyjson.com/products?limit=2',
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ products: [
        { title: 'First', stock: 20 },
        { title: 'Second', stock: 50 },
      ] }),
      truncated: false,
    });
    const read = vi.fn(async () => ({
      tool: 'capabilities.invoke',
      ok: true as const,
      data: { capabilityId: 'http.request', data: response, citations: [], untrusted: true },
    }));
    const service = new AxCommandService(store, { readGateway: { execute: read } });
    const textSeen: TextGenerateInput[] = [];
    const originalRequest = 'DummyJSON에서 GET products?limit=2 를 조회해서 상품명과 재고를 표로 보여줘.';

    const reply = await runAxCommandChat({
      harness: new AgentHarness(scriptedModel([], [], 'test-provider', [], textSeen)),
      commandService: service,
      messages: [
        { role: 'user', content: originalRequest },
        { role: 'assistant', content: '조회할 HTTP 연결을 선택해 주세요.' },
      ],
      userMessage: 'HTTP 연결 ID dummyjson를 사용해줘',
      httpEndpoints: [{ id: 'dummyjson', label: 'DummyJSON', usable: true }],
    });

    expect(reply).toContain('| title | stock |');
    expect(textSeen).toHaveLength(0);
    expect(read).toHaveBeenCalledOnce();
    db.close();
  });

  it('lets Jev select a schema-bound filter and returns the local result without a text-model call', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const response = buildHttpResponseArtifact({
      executionId: 'selected-http-filter',
      url: 'https://dummyjson.com/products?limit=2',
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ products: [
        { title: 'First', stock: 20 },
        { title: 'Second', stock: 50 },
      ] }),
      truncated: false,
    });
    const service = new AxCommandService(store, {
      readGateway: {
        execute: async () => ({
          tool: 'capabilities.invoke',
          ok: true,
          data: { capabilityId: 'http.request', data: response, citations: [], untrusted: true },
        }),
      },
    });
    const textSeen: TextGenerateInput[] = [];
    const jevRequests: Parameters<DecisionEngine['evaluate']>[0][] = [];
    const decisionEngine: DecisionEngine = {
      evaluate: async (request) => {
        jevRequests.push(request);
        const valueChoice = Object.entries(request.questions.filter_value?.type === 'choice'
          ? request.questions.filter_value.criteria
          : {}).find(([, description]) => Boolean(description && typeof description === 'object'
            && 'value' in description && description.value === 30))?.[0] ?? 'none';
        return {
          answers: {
            table_transform: {
              type: 'choice', choice: 'filter', probabilities: { filter: 0.99 }, confidence: 0.99,
            },
            filter_column: { type: 'choice', choice: 'column_1', probabilities: { column_1: 0.99 }, confidence: 0.99 },
            filter_operator: { type: 'choice', choice: 'lt', probabilities: { lt: 0.99 }, confidence: 0.99 },
            filter_value: { type: 'choice', choice: valueChoice, probabilities: { [valueChoice]: 0.99 }, confidence: 0.99 },
          },
        };
      },
    };
    const originalRequest = 'DummyJSON GET products?limit=2를 조회하고 재고 30개 미만인 상품의 상품명과 재고를 표로 보여줘.';

    const reply = await runAxCommandChat({
      harness: new AgentHarness(scriptedModel([], [], 'test-provider', ['재고가 30개 미만인 상품은 First입니다.'], textSeen)),
      commandService: service,
      decisionEngine,
      messages: [
        { role: 'user', content: originalRequest },
        { role: 'assistant', content: '조회할 HTTP 연결을 선택해 주세요.' },
      ],
      userMessage: 'HTTP 연결 ID dummyjson를 사용해줘',
      httpEndpoints: [{ id: 'dummyjson', label: 'DummyJSON', usable: true }],
    });

    expect(reply).toContain('| title | stock |');
    expect(reply).toContain('| First | 20 |');
    expect(reply).not.toContain('| Second | 50 |');
    expect(textSeen).toHaveLength(0);
    expect(jevRequests).toHaveLength(1);
    expect(JSON.stringify(jevRequests[0]?.state)).not.toContain('First');
    expect(jevRequests[0]?.questions).toHaveProperty('filter_column');
    db.close();
  });

  it('keeps Jev auto-selected raw display authoritative over lexical render gates', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const response = buildHttpResponseArtifact({
      executionId: 'selected-http-raw',
      url: 'https://dummyjson.com/products?limit=2',
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ products: [
        { title: 'First', stock: 20 },
        { title: 'Second', stock: 50 },
      ] }),
      truncated: false,
    });
    const service = new AxCommandService(store, {
      readGateway: {
        execute: async () => ({
          tool: 'capabilities.invoke',
          ok: true,
          data: { capabilityId: 'http.request', data: response, citations: [], untrusted: true },
        }),
      },
    });
    const textSeen: TextGenerateInput[] = [];
    const jevRequests: Parameters<DecisionEngine['evaluate']>[0][] = [];
    const decisionEngine: DecisionEngine = {
      evaluate: async (request) => {
        jevRequests.push(request);
        return {
          answers: {
            table_transform: {
              type: 'choice', choice: 'none', probabilities: { none: 0.99 }, confidence: 0.99,
            },
          },
        };
      },
    };
    const originalRequest = 'DummyJSON GET products?limit=2를 조회해 원본 그대로 표로 보여줘. 문장에 "정렬"이란 단어가 있어도 정렬하지 마.';

    const reply = await runAxCommandChat({
      harness: new AgentHarness(scriptedModel([], [], 'test-provider', ['LLM should not run'], textSeen)),
      commandService: service,
      decisionEngine,
      messages: [
        { role: 'user', content: originalRequest },
        { role: 'assistant', content: '조회할 HTTP 연결을 선택해 주세요.' },
      ],
      userMessage: 'HTTP 연결 ID dummyjson를 사용해줘',
      httpEndpoints: [{ id: 'dummyjson', label: 'DummyJSON', usable: true }],
    });

    expect(reply).toContain('| title | stock |');
    expect(reply).toContain('| First | 20 |');
    expect(reply).toContain('| Second | 50 |');
    expect(textSeen).toHaveLength(0);
    expect(jevRequests).toHaveLength(1);
    expect(jevRequests[0]?.questions).toHaveProperty('table_transform');
    db.close();
  });

  it('does not reuse an HTTP path from an older unrelated user message', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const read = vi.fn(async () => ({
      tool: 'capabilities.invoke',
      ok: true as const,
      data: { status: 200, body: '[]' },
    }));
    const service = new AxCommandService(store, { readGateway: { execute: read } });
    const decisionEngine: DecisionEngine = {
      evaluate: async () => ({
        answers: { route: { type: 'choice', choice: 'answer', probabilities: { answer: 1 }, confidence: 1 } },
      }),
    };

    await runAxCommandChat({
      harness: new AgentHarness(scriptedModel([], [], 'test-provider', ['어떤 요청을 조회할지 알려 주세요.'])),
      commandService: service,
      decisionEngine,
      connectedConnectors: ['http'],
      httpEndpoints: [{ id: 'dummyjson', label: 'DummyJSON', usable: true }],
      messages: [
        { role: 'user', content: 'DummyJSON GET products?limit=2 를 조회해줘.' },
        { role: 'assistant', content: '이전 조회가 완료되었습니다.' },
        { role: 'user', content: '이번에는 다른 질문이 있어.' },
        { role: 'assistant', content: '어떤 HTTP 연결을 사용할까요?' },
      ],
      userMessage: 'HTTP 연결 ID dummyjson를 사용해줘',
    });

    expect(read).not.toHaveBeenCalled();
    db.close();
  });
});
