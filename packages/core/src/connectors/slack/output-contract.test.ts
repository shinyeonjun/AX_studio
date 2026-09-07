import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getCapability } from '../../catalog/capabilities.js';
import { materializeStepOutputs } from '../../runtime/output-ports.js';
import { SlackConnector } from './connector.js';

const api = vi.hoisted(() => ({ list: vi.fn(), history: vi.fn(), search: vi.fn() }));
vi.mock('@slack/web-api', () => ({ WebClient: class {
  conversations = { list: api.list, history: api.history };
  search = { messages: api.search };
} }));
beforeEach(() => vi.resetAllMocks());

describe.each(['channels.list', 'messages.search', 'messages.read'])('Slack %s public page output contracts', (action) => {
  it.each(['first', 'last', 'empty'])('materializes the %s page with the registered capability IO', async (page) => {
    const metadata = { next_cursor: page === 'first' ? 'next-slack-page' : '' };
    api.list.mockResolvedValue({ channels: page === 'empty' ? [] : [{ id: 'C123', name: 'general' }], response_metadata: metadata });
    api.history.mockResolvedValue({ messages: page === 'empty' ? [] : [{ type: 'message', ts: '2.000', text: 'hello' }], response_metadata: metadata });
    api.search.mockResolvedValue({ messages: {
      matches: page === 'empty' ? [] : [{ channel: { id: 'C123' }, ts: '2.000', text: 'hello' }],
      ...(page === 'first' ? { total: 23 } : {}),
    }, response_metadata: metadata });
    const result = await new SlackConnector('test').execute(action, {
      channel: 'C123', query: 'test', ...(page === 'first' ? {} : { cursor: 'requested-page' }),
    }, {
      executionId: 'outputs', variables: {}, log: () => undefined,
    });
    expect(result.ok).toBe(true);
    const original = structuredClone(result.data);
    const contracts = getCapability(`slack.${action}`)!.io!.outputs;
    const outputs = materializeStepOutputs('slack-page', contracts, result.data);
    expect(Object.keys(outputs)).toEqual(Object.keys(contracts));
    for (const port of Object.keys(contracts)) expect(result.data).toHaveProperty(port);
    expect(outputs.truncated).toEqual({ value: page === 'first' });
    const tablePorts = Object.entries(contracts).filter(([, type]) => type === 'TableArtifact').map(([port]) => port);
    for (const port of tablePorts) {
      expect(outputs[port]).toMatchObject({ completeness: { status: 'partial', hasMore: page === 'first' } });
    }
    expect(result.data).toEqual(original);
    if (page === 'first') {
      expect(result.data).toHaveProperty('nextCursor', 'next-slack-page');
    } else {
      for (const key of ['nextCursor', 'nextLatest', 'nextPage', 'total', 'paginationLimitReached']) {
        expect(result.data).not.toHaveProperty(key);
      }
    }
  });

  it('marks a complete initial response with no continuation as complete', async () => {
    api.list.mockResolvedValue({ channels: [] });
    api.history.mockResolvedValue({ messages: [] });
    api.search.mockResolvedValue({ messages: { matches: [] }, response_metadata: { next_cursor: '' } });
    const result = await new SlackConnector('test').execute(action, { channel: 'C123', query: 'test' }, {
      executionId: 'outputs', variables: {}, log: () => undefined,
    });
    const contracts = getCapability(`slack.${action}`)!.io!.outputs;
    const outputs = materializeStepOutputs('slack-page', contracts, result.data);
    for (const [port, type] of Object.entries(contracts)) {
      if (type === 'TableArtifact') expect(outputs[port]).toMatchObject({ completeness: { status: 'complete', hasMore: false } });
    }
  });
});

it('materializes timestamp continuation without fabricating a cursor', async () => {
  api.history.mockResolvedValue({ messages: [{ type: 'message', ts: '2.000', text: 'hello' }], has_more: true });
  const result = await new SlackConnector('test').execute('messages.read', { channel: 'C123', limit: 1 }, {
    executionId: 'outputs', variables: {}, log: () => undefined,
  });
  expect(result).toMatchObject({ ok: true, data: { nextLatest: '2.000', truncated: true } });
  const outputs = materializeStepOutputs('slack-page', getCapability('slack.messages.read')!.io!.outputs, result.data);
  expect(outputs.messages).toMatchObject({ kind: 'table' });
  expect(result.data).not.toHaveProperty('nextCursor');
});

it.each([
  ['messages.search', { query: 'test', page: 2 }],
  ['messages.read', { channel: 'C123', latest: '2.000' }],
])('preserves terminal %s request bounds as partial after materialization', async (action, params) => {
  api.search.mockResolvedValue({ messages: { matches: [] } });
  api.history.mockResolvedValue({ messages: [] });
  const result = await new SlackConnector('test').execute(action, params, {
    executionId: 'outputs', variables: {}, log: () => undefined,
  });
  expect(result).toMatchObject({ ok: true, data: {
    truncated: false, completeness: { status: 'partial', hasMore: false, observedCount: 0 },
  } });
  const contracts = getCapability(`slack.${action}`)!.io!.outputs;
  const outputs = materializeStepOutputs('slack-page', contracts, result.data);
  for (const [port, type] of Object.entries(contracts)) {
    if (type === 'TableArtifact') expect(outputs[port]).toMatchObject({ completeness: { status: 'partial', hasMore: false } });
  }
  expect(result.data).not.toHaveProperty('total');
});
