import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The settings screen talks to these handlers. Each one checks what the window sent, hands it to
 * its connection module, and tells every screen the connections changed.
 */
const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  core: {} as Record<string, unknown>,
  notifyStateChanged: vi.fn(),
  validateAndConnectHttp: vi.fn(),
  disconnectHttp: vi.fn(),
  validateAndConnectWebhook: vi.fn(),
  disconnectWebhook: vi.fn(),
  connectSlack: vi.fn(),
  disconnectSlack: vi.fn(),
  connectGmailOAuth: vi.fn(),
  disconnectGmailOAuth: vi.fn(),
}));

vi.mock('../ipc-handle.js', () => ({
  ipcHandle: (channel: string, handler: (...args: unknown[]) => unknown) => mocks.handlers.set(channel, handler),
}));
vi.mock('../../core-instance.js', () => ({ getCore: () => mocks.core }));
vi.mock('../../state-broadcast.js', () => ({ notifyStateChanged: mocks.notifyStateChanged }));
vi.mock('../../http/connection.js', () => ({ validateAndConnectHttp: mocks.validateAndConnectHttp, disconnectHttp: mocks.disconnectHttp }));
vi.mock('../../webhook/connection.js', () => ({ validateAndConnectWebhook: mocks.validateAndConnectWebhook, disconnectWebhook: mocks.disconnectWebhook }));
vi.mock('../../slack/connection.js', () => ({ connectSlack: mocks.connectSlack, disconnectSlack: mocks.disconnectSlack }));
vi.mock('../../gmail/connection.js', () => ({ connectGmailOAuth: mocks.connectGmailOAuth, disconnectGmailOAuth: mocks.disconnectGmailOAuth }));

import { registerHttpConnectionHandlers } from './http.js';
import { registerWebhookConnectionHandlers } from './webhook.js';
import { registerSlackConnectionHandlers } from './slack.js';
import { registerGmailConnectionHandlers } from './gmail.js';

const call = (channel: string, ...args: unknown[]) => mocks.handlers.get(channel)!({}, ...args);

beforeEach(() => {
  for (const mock of Object.values(mocks)) if (typeof mock === 'function' && 'mockReset' in mock) mock.mockReset();
  mocks.handlers.clear();
  mocks.core = { store: { name: 'store' }, runtime: { name: 'runtime' }, triggerEngine: {
    refreshPushTransports: vi.fn(async () => undefined),
    pushTransportStatus: vi.fn(() => ({ phase: 'connected' })),
    pushTransportActive: vi.fn(() => true),
  } };
  registerHttpConnectionHandlers();
  registerWebhookConnectionHandlers();
  registerSlackConnectionHandlers();
  registerGmailConnectionHandlers();
});

describe('HTTP connection handlers', () => {
  it('passes only the known fields on and announces the change', async () => {
    await expect(call('ax:connectHttp', { baseUrl: 'https://shop.example.com', authType: 'bearer', token: 't', extra: 'ignored' }))
      .resolves.toEqual({ ok: true });
    expect(mocks.validateAndConnectHttp).toHaveBeenCalledWith(mocks.core.store, mocks.core.runtime, expect.objectContaining({
      baseUrl: 'https://shop.example.com', authType: 'bearer', token: 't',
    }));
    expect(JSON.stringify(mocks.validateAndConnectHttp.mock.calls[0])).not.toContain('extra');
    expect(mocks.notifyStateChanged).toHaveBeenCalledTimes(1);
  });

  it('refuses malformed input before touching anything', async () => {
    await expect(call('ax:connectHttp', 'https://x')).rejects.toThrow('HTTP 연결 정보 형식이 올바르지 않습니다.');
    await expect(call('ax:connectHttp', { baseUrl: 'https://x', authType: 'oauth' })).rejects.toThrow('인증 유형이 올바르지 않습니다.');
    // A malformed id must not become "disconnect every endpoint".
    await expect(call('ax:disconnectHttp', '  ')).rejects.toThrow('해제할 HTTP 연결을 찾을 수 없어요');
    await expect(call('ax:disconnectHttp', 42)).rejects.toThrow('해제할 HTTP 연결을 찾을 수 없어요');
    expect(mocks.validateAndConnectHttp).not.toHaveBeenCalled();
    expect(mocks.disconnectHttp).not.toHaveBeenCalled();
  });

  it('disconnects the named endpoint, or all when none is named', async () => {
    await call('ax:disconnectHttp', ' shop ');
    await call('ax:disconnectHttp');
    expect(mocks.disconnectHttp.mock.calls.map((args) => args[2])).toEqual(['shop', undefined]);
    expect(mocks.notifyStateChanged).toHaveBeenCalledTimes(2);
  });
});

describe('Webhook connection handlers', () => {
  it('connects, then checks the listener really started', async () => {
    mocks.validateAndConnectWebhook.mockImplementation(async (_store, _input, start: () => Promise<void>) => start());
    await expect(call('ax:connectWebhook', { port: '8787', secret: 's'.repeat(32) })).resolves.toEqual({ ok: true });
    expect(mocks.validateAndConnectWebhook.mock.calls[0]![1]).toMatchObject({ port: 8787, secret: 's'.repeat(32) });
    expect(mocks.notifyStateChanged).toHaveBeenCalledTimes(1);
  });

  it('reports a listener that did not start, and still refreshes the screens', async () => {
    (mocks.core.triggerEngine as { pushTransportStatus: ReturnType<typeof vi.fn> }).pushTransportStatus.mockReturnValue({ phase: 'error', error: '포트가 이미 쓰이고 있어요.' });
    mocks.validateAndConnectWebhook.mockImplementation(async (_store, _input, start: () => Promise<void>) => start());
    await expect(call('ax:connectWebhook', { port: 8787, secret: 's'.repeat(32) })).rejects.toThrow('포트가 이미 쓰이고 있어요.');
    expect(mocks.notifyStateChanged).toHaveBeenCalledTimes(1);
  });

  it('refuses a payload that is not an object', async () => {
    await expect(call('ax:connectWebhook', 8787)).rejects.toThrow('Webhook 연결 정보 형식이 올바르지 않습니다.');
    expect(mocks.validateAndConnectWebhook).not.toHaveBeenCalled();
  });
});

describe('Slack connection handlers', () => {
  it('reads both tokens, trimmed, and refreshes the screens even when Slack refuses', async () => {
    mocks.connectSlack.mockResolvedValueOnce({ ok: true, socketModeActive: true, hasAppToken: true });
    await expect(call('ax:connectSlack', { token: ' xoxb-1 ', appToken: ' xapp-1 ' })).resolves.toMatchObject({ ok: true });
    expect(mocks.connectSlack).toHaveBeenCalledWith(mocks.core, { token: 'xoxb-1', appToken: 'xapp-1' });

    mocks.connectSlack.mockRejectedValueOnce(new Error('토큰이 만료되었습니다.'));
    await expect(call('ax:connectSlack', 'xoxb-2')).rejects.toThrow('토큰이 만료되었습니다.');
    expect(mocks.notifyStateChanged).toHaveBeenCalledTimes(2);
  });

  it('refuses a malformed App-Level Token field', async () => {
    await expect(call('ax:connectSlack', { token: 'xoxb-1', appToken: 7 })).rejects.toThrow('App-Level Token 형식이 올바르지 않습니다.');
    expect(mocks.connectSlack).not.toHaveBeenCalled();
  });

  it('disconnects and announces it', async () => {
    await expect(call('ax:disconnectSlack')).resolves.toEqual({ ok: true });
    expect(mocks.disconnectSlack).toHaveBeenCalledWith(mocks.core);
    expect(mocks.notifyStateChanged).toHaveBeenCalledTimes(1);
  });
});

describe('Gmail connection handlers', () => {
  it('announces the change after connecting or disconnecting, also when sign-in fails', async () => {
    mocks.connectGmailOAuth.mockResolvedValueOnce({ ok: true, email: 'me@example.com' });
    await expect(call('ax:connectGmailOAuth')).resolves.toEqual({ ok: true, email: 'me@example.com' });
    mocks.connectGmailOAuth.mockRejectedValueOnce(new Error('Google 로그인에 실패했어요.'));
    await expect(call('ax:connectGmailOAuth')).rejects.toThrow('Google 로그인에 실패했어요.');
    mocks.disconnectGmailOAuth.mockResolvedValueOnce({ ok: true });
    await expect(call('ax:disconnectGmailOAuth')).resolves.toEqual({ ok: true });
    expect(mocks.connectGmailOAuth).toHaveBeenCalledWith(mocks.core.store, mocks.core.runtime);
    expect(mocks.notifyStateChanged).toHaveBeenCalledTimes(3);
  });
});
