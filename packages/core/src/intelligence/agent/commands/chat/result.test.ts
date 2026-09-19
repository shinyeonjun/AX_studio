import { describe, expect, it } from 'vitest';
import { buildHttpResponseArtifact } from '../../../../contracts/artifacts/http-response.js';
import type { AxCommand, AxCommandResult } from '../schema.js';
import { deterministicCapabilityReadChatReply, deterministicHttpChatReply } from './result.js';
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

  it('projects explicitly requested HTTP fields instead of rendering provider metadata', () => {
    const reply = deterministicHttpChatReply(
      httpGetCommand,
      httpResult(JSON.stringify({ products: [{
        id: 1,
        title: 'Essence Mascara Lash Princess',
        description: 'popular mascara',
        category: 'beauty',
        price: 9.99,
        stock: 99,
        images: ['https://cdn.example.test/product.jpg'],
      }] })),
      'DummyJSON에서 상품 5개만 가져와서 상품명, 가격, 카테고리, 재고를 표로 보여줘.',
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
});
