import type { WebClient } from '@slack/web-api';
import { describe, expect, it, vi } from 'vitest';
import { MockSlackConnector } from '../mocks/slack.js';
import { executeDesignTool } from '../../design-tools/execute.js';
import { buildDesignToolContext } from '../../design-tools/context.js';
import { readSlackChannelMessages } from './read.js';

describe('Slack read knowledge', () => {
  it('reads additional history pages to fill the requested user-message limit', async () => {
    const history = vi
      .fn()
      .mockResolvedValueOnce({
        messages: [
          { type: 'message', subtype: 'channel_join', ts: '104.000', text: 'joined' },
          { type: 'message', ts: '103.000', text: 'third', user: 'U3' },
          { type: 'message', subtype: 'bot_message', ts: '102.500', text: 'bot' },
        ],
        response_metadata: { next_cursor: 'page-2' },
      })
      .mockResolvedValueOnce({
        messages: [
          { type: 'message', ts: '102.000', text: 'second', user: 'U2' },
          { type: 'message', ts: '101.000', text: 'first', user: 'U1' },
          { type: 'message', ts: '100.000', text: 'outside limit', user: 'U0' },
        ],
        response_metadata: { next_cursor: 'page-3' },
      });
    const client = { conversations: { history } } as unknown as WebClient;

    const result = await readSlackChannelMessages(client, 'C123', 3);

    expect(history).toHaveBeenNthCalledWith(1, { channel: 'C123', limit: 3, cursor: undefined });
    expect(history).toHaveBeenNthCalledWith(2, { channel: 'C123', limit: 3, cursor: 'page-2' });
    expect(history).toHaveBeenCalledTimes(2);
    expect(result.messages.map((message) => message.ts)).toEqual(['103.000', '102.000', '101.000']);
  });

  it('searches messages with citations', async () => {
    const slack = new MockSlackConnector();
    const result = await slack.execute('messages.search', { query: 'deploy' }, {
      executionId: 't',
      variables: {},
      log: () => undefined,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const data = result.data as { hits: Array<{ ref: { id: string }; snippet?: string }> };
      expect(data.hits).toHaveLength(1);
      expect(data.hits[0]?.ref.id).toBe('C_GENERAL:100.002');
    }
  });

  it('invokes slack.messages.search via capabilities.invoke', async () => {
    const slack = new MockSlackConnector();
    const ctx = buildDesignToolContext(
      [{ connector: 'slack', connected: true }],
      ['slack'],
      { allowUntrustedData: true, connectors: { slack } },
    );
    const result = await executeDesignTool(
      { tool: 'capabilities.invoke', args: { id: 'slack.messages.search', params: { query: 'deploy' } } },
      ctx,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const envelope = result.data as { citations: unknown[]; capabilityId: string };
      expect(envelope.capabilityId).toBe('slack.messages.search');
      expect(envelope.citations.length).toBeGreaterThan(0);
    }
  });

  it('blocks write capabilities in plain chat invoke', async () => {
    const slack = new MockSlackConnector();
    const ctx = buildDesignToolContext(
      [{ connector: 'slack', connected: true }],
      ['slack'],
      { allowUntrustedData: true, connectors: { slack } },
    );
    const result = await executeDesignTool(
      { tool: 'capabilities.invoke', args: { id: 'slack.message.send', params: { channel: '#general', text: 'hi' } } },
      ctx,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('capability_not_readable');
    }
  });
});
