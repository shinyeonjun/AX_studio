import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  validateSlackBotToken: vi.fn(),
  stored: undefined as { token: string; appToken?: string } | undefined,
}));

vi.mock('@ax-studio/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@ax-studio/core')>()),
  validateSlackBotToken: mocks.validateSlackBotToken,
}));
vi.mock('./secrets.js', () => ({
  getSlackSecretForConnect: vi.fn(async () => mocks.stored ?? null),
  saveSlackSecret: vi.fn(async (secret: { token: string; appToken?: string }) => { mocks.stored = secret; }),
  deleteSlackSecret: vi.fn(async () => { mocks.stored = undefined; }),
}));

import { connectSlack, disconnectSlack } from './connect.js';

type Row = { connector: string; connected: boolean; config?: Record<string, unknown> };

function host(initial?: Row) {
  let row = initial;
  const connectors: Record<string, unknown> = {};
  const socket = { refreshSlackSocket: vi.fn(async () => undefined), slackSocketActive: vi.fn(() => true) };
  return {
    row: () => row,
    connectors,
    triggerEngine: socket,
    store: {
      getConnections: () => (row ? [row] : []),
      setConnection: (connector: string, connected: boolean, config?: Record<string, unknown>) => { row = { connector, connected, config }; },
    },
    runtime: { setConnector: (id: string, connector: unknown) => { if (connector) connectors[id] = connector; else delete connectors[id]; } },
  };
}

beforeEach(() => {
  mocks.stored = undefined;
  mocks.validateSlackBotToken.mockReset().mockResolvedValue({ ok: true, team: 'AX 팀', botUser: 'ax-bot' });
});

describe('connecting Slack', () => {
  it('checks the token, keeps it in the secure store, installs the connector and starts Socket Mode', async () => {
    const h = host();
    const result = await connectSlack(h as never, { token: 'xoxb-new', appToken: 'xapp-new' });
    expect(result).toEqual({ ok: true, socketModeActive: true, hasAppToken: true });
    expect(mocks.stored).toEqual({ token: 'xoxb-new', appToken: 'xapp-new' });
    expect(h.connectors.slack).toBeDefined();
    expect(h.row()).toMatchObject({ connected: true, config: { team: 'AX 팀', botUser: 'ax-bot', tokenStored: true, appTokenStored: true } });
    expect(JSON.stringify(h.row())).not.toContain('xoxb-new');
    expect(h.triggerEngine.refreshSlackSocket).toHaveBeenCalledWith({ token: 'xoxb-new', appToken: 'xapp-new' });
  });

  it('refuses tokens of the wrong kind before asking Slack', async () => {
    await expect(connectSlack(host() as never, { token: 'xoxp-user' })).rejects.toThrow('xoxb-');
    await expect(connectSlack(host() as never, { token: 'xoxb-ok', appToken: 'bad' })).rejects.toThrow('xapp-');
    await expect(connectSlack(host() as never, { token: '' })).rejects.toThrow('Bot Token을 입력해 주세요.');
    expect(mocks.validateSlackBotToken).not.toHaveBeenCalled();
  });

  it('keeps a working connection when a replacement token is rejected, and says why', async () => {
    const h = host({ connector: 'slack', connected: true, config: { team: 'AX 팀', tokenStored: true } });
    mocks.stored = { token: 'xoxb-old' };
    mocks.validateSlackBotToken.mockResolvedValue({ ok: false, error: '토큰이 만료되었습니다.' });
    await expect(connectSlack(h as never, { token: 'xoxb-bad' })).rejects.toThrow('토큰이 만료되었습니다.');
    expect(h.row()).toMatchObject({ connected: true, config: { team: 'AX 팀', lastError: '토큰이 만료되었습니다.' } });
    expect(mocks.stored).toEqual({ token: 'xoxb-old' });
  });

  it('reuses the stored token when the field is left blank', async () => {
    mocks.stored = { token: 'xoxb-stored', appToken: 'xapp-stored' };
    const h = host({ connector: 'slack', connected: true, config: {} });
    await connectSlack(h as never, { token: '' });
    expect(mocks.validateSlackBotToken).toHaveBeenCalledWith('xoxb-stored');
    expect(mocks.stored).toEqual({ token: 'xoxb-stored', appToken: 'xapp-stored' });
  });

  it('stays connected with a warning when Socket Mode does not start', async () => {
    const h = host();
    h.triggerEngine.refreshSlackSocket.mockRejectedValueOnce(new Error('소켓 거부'));
    const result = await connectSlack(h as never, { token: 'xoxb-new', appToken: 'xapp-new' });
    expect(result).toMatchObject({ ok: true, socketModeActive: false, warning: expect.stringContaining('소켓 거부') });
    expect(h.row()).toMatchObject({ connected: true, config: { lastError: '소켓 거부' } });
  });

  it('disconnects everything it set up', async () => {
    const h = host();
    await connectSlack(h as never, { token: 'xoxb-new' });
    await disconnectSlack(h as never);
    expect(h.connectors.slack).toBeUndefined();
    expect(mocks.stored).toBeUndefined();
    expect(h.row()).toMatchObject({ connected: false });
    expect(h.triggerEngine.refreshSlackSocket).toHaveBeenLastCalledWith(null);
  });
});
