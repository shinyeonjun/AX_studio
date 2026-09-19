import { describe, expect, it } from 'vitest';
import { buildHttpResponseArtifact } from '../../../../contracts/artifacts/http-response.js';
import type { AxCommand, AxCommandResult } from '../schema.js';
import { deterministicHttpChatReply } from './result.js';

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
});
