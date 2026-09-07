import { describe, expect, it } from 'vitest';
import { GmailConnector } from './connector.js';

const ctx = {
  executionId: 'run-1',
  variables: {},
  log: () => {},
};

describe('GmailConnector', () => {
  const connector = new GmailConnector({
    clientId: 'client-id',
    refreshToken: 'refresh-token',
  });

  it.each(['draft.create', 'message.send'])('rejects %s without a recipient', async (action) => {
    const result = await connector.execute(action, { body: 'hello' }, ctx);

    expect(result).toEqual({ ok: false, error: 'to_required', errorCode: 'invalid_params' });
  });

  it.each(['draft.create', 'message.send'])('rejects %s without a body', async (action) => {
    const result = await connector.execute(action, { to: 'person@example.com', body: '   ' }, ctx);

    expect(result).toEqual({ ok: false, error: 'body_required', errorCode: 'invalid_params' });
  });
});
