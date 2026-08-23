import { describe, expect, it } from 'vitest';
import { MockSlackConnector } from '../mocks/slack.js';
import { executeDesignTool } from '../../design-tools/execute.js';
import { buildDesignToolContext } from '../../design-tools/context.js';

describe('Slack read knowledge', () => {
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
