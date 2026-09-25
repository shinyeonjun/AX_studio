import { describe, expect, it } from 'vitest';
import { buildHttpResponseArtifact } from '../../../../contracts/artifacts/http-response.js';
import type { AxCommand, AxCommandResult } from '../schema.js';
import {
  deterministicCapabilityReadChatReply,
  deterministicHttpChatReply,
  deterministicHttpConnectionListChatReply,
  deterministicMetadataChatReply,
  deterministicWorkflowListChatReply,
  selectedColumnsFromHttpPath,
} from './result.js';
import { resultMessage } from './protocol.js';

const httpGetCommand: AxCommand = {
  name: 'capability.invoke',
  args: { id: 'http.request', params: { method: 'GET' } },
};

function httpResult(body: string): AxCommandResult {
  return {
    command: 'capability.invoke',
    status: 'ok',
    data: buildHttpResponseArtifact({
      executionId: 'test',
      url: 'https://example.test/items',
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/json' },
      body,
      truncated: false,
    }),
    issues: [],
    inputRequests: [],
  };
}

describe('deterministicHttpChatReply', () => {
  it('renders a bounded JSON GET response without a second model turn', () => {
    const reply = deterministicHttpChatReply(httpGetCommand, httpResult('{"ok":true}'), 'GET /items 조회해줘.');

    expect(reply).toContain('HTTP 200 조회 결과:');
    expect(reply).toContain('"ok": true');
    expect(reply).toMatch(/\n```json[\s\S]*```$/);
  });

  it('leaves semantic transformations for the text model', () => {
    expect(deterministicHttpChatReply(
      httpGetCommand,
      httpResult('{"items":[{"price":2},{"price":1}]}'),
      '방금 조회한 결과를 가격순으로 정렬해줘.',
    )).toBeUndefined();
  });

  it('projects fields explicitly selected in the HTTP path instead of rendering provider metadata', () => {
    const reply = deterministicHttpChatReply(
      { ...httpGetCommand, args: { id: 'http.request', params: {
        method: 'GET', path: 'products?select=title%2Cprice%2Ccategory%2Cstock',
      } } },
      httpResult(JSON.stringify({ products: [{
        id: 1,
        title: 'Essence Mascara Lash Princess',
        description: 'popular mascara',
        category: 'beauty',
        price: 9.99,
        stock: 99,
        images: ['https://cdn.example.test/product.jpg'],
      }] })),
      'DummyJSON에서 지정한 열을 표로 보여줘.',
    );

    expect(reply?.split('\n', 1)[0]).toBe('| title | price | category | stock |');
    expect(reply).not.toContain('description');
    expect(reply).not.toContain('https://cdn.example.test/product.jpg');
  });

  it('honors an HTTP select query and preserves its field order', () => {
    const reply = deterministicHttpChatReply(
      { ...httpGetCommand, args: { id: 'http.request', params: { method: 'GET', path: 'products?select=stock%2Ctitle' } } },
      httpResult(JSON.stringify({ products: [{ title: 'First', stock: 3, price: 1.99 }] })),
      '응답을 표로 보여줘.',
    );

    expect(reply?.split('\n', 1)[0]).toBe('| stock | title |');
  });

  it('does not treat a comparison-filter request as a plain table display', () => {
    const reply = deterministicHttpChatReply(
      httpGetCommand,
      httpResult(JSON.stringify({ products: [{ title: 'A', stock: 20 }, { title: 'B', stock: 50 }] })),
      '재고가 30개 미만인 상품만 표로 보여줘.',
    );

    expect(reply).toBeUndefined();
  });

  it('bounds a complete host result only when serializing it for the model', () => {
    const result: AxCommandResult = {
      command: 'capability.invoke',
      status: 'ok',
      data: {
        capabilityId: 'http.request',
        data: buildHttpResponseArtifact({
          executionId: 'test',
          url: 'https://example.test/items',
          status: 200,
          statusText: 'OK',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ payload: 'x'.repeat(5_000), marker: 'tail-marker' }),
          truncated: false,
        }),
        citations: [],
        untrusted: true,
      },
      issues: [],
      inputRequests: [],
    };

    const message = resultMessage(result);

    expect(message).toContain('"truncated":true');
    expect(message).not.toContain('tail-marker');
    expect(result.data).toMatchObject({ data: { truncated: false, completeness: { status: 'complete' } } });
  });
});

describe('selectedColumnsFromHttpPath', () => {
  it('decodes the actual query value, ignores fragments, and rejects partial field lists', () => {
    expect(selectedColumnsFromHttpPath({ path: 'products?select=stock%2Ctitle' })).toEqual(['stock', 'title']);
    expect(selectedColumnsFromHttpPath({ path: 'products?limit=5#?select=title,price' })).toBeUndefined();
    expect(selectedColumnsFromHttpPath({ path: 'products?select=title,invalid/name' })).toBeUndefined();
  });
});

describe('deterministicCapabilityReadChatReply', () => {
  it('renders a bounded table capability result without a second model turn', () => {
    const reply = deterministicCapabilityReadChatReply({
      name: 'capability.invoke',
      args: { id: 'rdb.query.read', params: { table: 'orders' } },
    }, {
      command: 'capability.invoke',
      status: 'ok',
      data: {
        capabilityId: 'rdb.query.read',
        data: {
          id: 'orders',
          kind: 'table',
          columns: [{ name: 'id', type: 'integer', nullable: false, inferred: false }],
          rows: [{ index: 0, values: { id: 1 } }],
        },
        citations: [],
        untrusted: true,
      },
      issues: [],
      inputRequests: [],
    }, '주문을 표로 보여줘');

    expect(reply).toContain('| id |');
    expect(reply).toContain('| 1 |');
  });

  it('bounds only the displayed table while preserving the complete source result', () => {
    const columns = Array.from({ length: 51 }, (_, index) => ({
      name: `column_${index}`,
      type: 'string',
      nullable: true,
      inferred: false,
    }));
    const rows = Array.from({ length: 150 }, (_, index) => ({
      index,
      values: Object.fromEntries(columns.map((column) => [column.name, `row_${index}`])),
    }));
    const result: AxCommandResult = {
      command: 'capability.invoke',
      status: 'ok',
      data: {
        capabilityId: 'rdb.query.read',
        data: { id: 'orders', kind: 'table', columns, rows, truncated: false },
        citations: [],
        untrusted: true,
      },
      issues: [],
      inputRequests: [],
    };

    const reply = deterministicCapabilityReadChatReply({
      name: 'capability.invoke',
      args: { id: 'rdb.query.read', params: { table: 'orders' } },
    }, result, '주문을 표로 보여줘');

    expect(reply).toContain('전체 150행 중 처음 100행');
    expect(reply).toContain('전체 51열 중 처음 50열');
    expect(reply).toContain('row_99');
    expect(reply).not.toContain('row_100');
    expect(reply).not.toContain('| column_50 |');
    expect(rows).toHaveLength(150);
    expect(rows.at(-1)?.values.column_50).toBe('row_149');
    expect(columns).toHaveLength(51);
  });

  it('uses the same display budget for plain row-array results', () => {
    const rows = Array.from({ length: 101 }, (_, index) => Object.fromEntries(
      Array.from({ length: 51 }, (__, column) => [`column_${column}`, `row_${index}`]),
    ));
    const reply = deterministicCapabilityReadChatReply({
      name: 'capability.invoke',
      args: { id: 'slack.messages.search', params: {} },
    }, {
      command: 'capability.invoke',
      status: 'ok',
      data: { capabilityId: 'slack.messages.search', data: rows, citations: [], untrusted: true },
      issues: [],
      inputRequests: [],
    }, '결과를 표로 보여줘');

    expect(reply).toContain('처음 50열만 표시했습니다.');
    expect(reply).toContain('전체 101행 중 처음 100행');
    expect(reply).toContain('row_99');
    expect(reply).not.toContain('row_100');
    expect(rows).toHaveLength(101);
  });

  it('keeps semantic transforms on the model path', () => {
    expect(deterministicCapabilityReadChatReply({
      name: 'capability.invoke',
      args: { id: 'rdb.query.read', params: { table: 'orders' } },
    }, {
      command: 'capability.invoke',
      status: 'ok',
      data: { data: { kind: 'table', rows: [] } },
      issues: [],
      inputRequests: [],
    }, '가격순으로 정렬해줘')).toBeUndefined();
  });

  it('keeps natural-language comparison filters on the model path', () => {
    const reply = deterministicCapabilityReadChatReply({
      name: 'capability.invoke',
      args: { id: 'rdb.query.read', params: { table: 'products' } },
    }, {
      command: 'capability.invoke',
      status: 'ok',
      data: { data: [{ title: 'A', stock: 20 }, { title: 'B', stock: 50 }] },
      issues: [],
      inputRequests: [],
    }, '재고가 30개 미만인 상품만 표로 보여줘.');

    expect(reply).toBeUndefined();
  });
});

describe('deterministicWorkflowListChatReply', () => {
  it('renders the complete workflow list without a text-model turn', () => {
    const reply = deterministicWorkflowListChatReply({ name: 'workflow.list', args: {} }, {
      command: 'workflow.list',
      status: 'ok',
      data: { workflows: [{ id: 'daily-1', name: 'Daily report', active: true, latestVersion: 3 }] },
      issues: [],
      inputRequests: [],
    }, '저장된 workflow 목록을 보여줘');

    expect(reply).toBe('저장된 workflow (1개):\n- "Daily report" — 활성, v3 (ID: "daily-1")');
  });

  it('escapes multiline user-controlled names and leaves semantic requests to the model', () => {
    const command: AxCommand = { name: 'workflow.list', args: {} };
    const result: AxCommandResult = {
      command: 'workflow.list',
      status: 'ok',
      data: { workflows: [{ id: 'id', name: 'Daily\n- injected', active: false, latestVersion: 0 }] },
      issues: [],
      inputRequests: [],
    };

    expect(deterministicWorkflowListChatReply(command, result, '저장된 workflow 목록을 보여줘'))
      .toContain('"Daily\\n- injected"');
    expect(deterministicWorkflowListChatReply(command, result, '저장된 workflow 목록을 설명해줘')).toBeUndefined();
  });

  it('renders an empty list without inventing an entry', () => {
    expect(deterministicWorkflowListChatReply({ name: 'workflow.list', args: {} }, {
      command: 'workflow.list',
      status: 'ok',
      data: { workflows: [] },
      issues: [],
      inputRequests: [],
    }, '저장된 workflow 목록을 보여줘')).toBe('저장된 workflow가 없습니다.');
  });
});

describe('deterministicMetadataChatReply', () => {
  it('renders host-bounded metadata as safe JSON without semantic model work', () => {
    const reply = deterministicMetadataChatReply({ name: 'resource.list', args: {} }, {
      command: 'resource.list',
      status: 'ok',
      data: { resources: [{ id: 'http', label: 'HTTP `catalog`', connected: true }] },
      issues: [],
      inputRequests: [],
    }, '연결된 리소스 목록을 보여줘');

    expect(reply).toContain('조회 결과:');
    expect(reply).toContain('"id": "http"');
    expect(reply).toContain('"HTTP `catalog`"');
    expect(reply).toMatch(/```json[\s\S]*```$/);
  });

  it('keeps semantic interpretation and non-metadata commands on their existing paths', () => {
    const result: AxCommandResult = {
      command: 'resource.list', status: 'ok', data: { resources: [] }, issues: [], inputRequests: [],
    };
    expect(deterministicMetadataChatReply({ name: 'resource.list', args: {} }, result, '연결된 리소스를 설명해줘'))
      .toBeUndefined();
    expect(deterministicMetadataChatReply({ name: 'resource.list', args: {} }, result, '어떤 리소스를 선택해야 해?'))
      .toBeUndefined();
    expect(deterministicMetadataChatReply({ name: 'source.search', args: {} }, {
      ...result, command: 'source.search', data: { hits: [] },
    }, '검색 결과를 보여줘')).toBeUndefined();
  });
});

describe('deterministicHttpConnectionListChatReply', () => {
  it('lists safe connection labels without a text-model paraphrase or base URL disclosure', () => {
    const reply = deterministicHttpConnectionListChatReply({ name: 'http.list', args: {} }, {
      command: 'http.list',
      status: 'ok',
      data: {
        connections: [{
          id: 'test', label: 'Test `connection`', baseUrl: 'https://private.example.test/',
          connected: true, usable: true,
        }],
        totalMatches: 1,
        truncated: false,
      },
      issues: [],
      inputRequests: [],
    }, '저장된 HTTP 연결을 모두 목록으로 보여줘');

    expect(reply).toContain('Test `connection`');
    expect(reply).toContain('ID: "test"');
    expect(reply).not.toContain('private.example.test');
  });

  it('keeps semantic requests and malformed host results on the existing path', () => {
    const command: AxCommand = { name: 'http.list', args: {} };
    const result: AxCommandResult = {
      command: 'http.list', status: 'ok', data: { connections: [] }, issues: [], inputRequests: [],
    };
    expect(deterministicHttpConnectionListChatReply(command, result, '연결 중 어떤 API가 가장 적합해?'))
      .toBeUndefined();
    expect(deterministicHttpConnectionListChatReply(command, {
      ...result, data: { connections: [{ id: 7, label: 'bad', connected: true, usable: true }] },
    }, 'HTTP 연결 목록을 보여줘')).toBeUndefined();
  });

  it('distinguishes an empty filtered page from having no saved connections', () => {
    const reply = deterministicHttpConnectionListChatReply({ name: 'http.list', args: { query: 'missing' } }, {
      command: 'http.list', status: 'ok',
      data: { connections: [], count: 2, totalMatches: 0, truncated: false },
      issues: [], inputRequests: [],
    }, 'HTTP 연결 중 missing을 찾아줘');
    expect(reply).toBe('조건에 맞는 HTTP 연결이 없습니다.');
  });
});
