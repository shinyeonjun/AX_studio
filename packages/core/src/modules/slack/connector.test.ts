import { describe, expect, it } from 'vitest';
import { SlackConnector } from './connector.js';

describe('SlackConnector', () => {
  it('rejects message.send without channel', async () => {
    const connector = new SlackConnector('xoxb-test-token');
    const result = await connector.execute('message.send', { text: 'hello' }, {
      executionId: 'run-1',
      variables: {},
      log: () => {},
    });

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('invalid_params');
    expect(result.error).toBe('channel_required');
  });

  it.each([
    ['missing', undefined],
    ['blank', '   '],
    ['non-string', 42],
  ])('rejects message.send with %s text', async (_label, text) => {
    const connector = new SlackConnector('xoxb-test-token');
    const result = await connector.execute('message.send', { channel: 'C123', text }, {
      executionId: 'run-1',
      variables: {},
      log: () => {},
    });

    expect(result).toEqual({ ok: false, error: 'text_required', errorCode: 'invalid_params' });
  });
});
