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
});
