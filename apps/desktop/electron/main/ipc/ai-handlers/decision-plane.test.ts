import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  readAiToml: vi.fn(),
  getJevSecret: vi.fn(),
  saveJevDecisionPreferences: vi.fn(),
  setJevSecret: vi.fn(),
  getCore: vi.fn(),
}));

vi.mock('../ipc-handle.js', () => ({
  ipcHandle: (channel: string, handler: (...args: unknown[]) => unknown) => mocks.handlers.set(channel, handler),
}));
vi.mock('../../core-instance.js', () => ({ getCore: mocks.getCore }));
vi.mock('../../ai/config-file.js', () => ({
  getJevSecret: mocks.getJevSecret,
  readAiToml: mocks.readAiToml,
  saveJevDecisionPreferences: mocks.saveJevDecisionPreferences,
  setJevSecret: mocks.setJevSecret,
}));
vi.mock('../../env-file.js', () => ({ maskSecret: () => 'synthetic-mask' }));

import { registerDecisionPlaneHandlers } from './decision-plane.js';

describe('Jev decision plane API key validation', () => {
  beforeEach(() => {
    mocks.handlers.clear();
    mocks.readAiToml.mockReset().mockResolvedValue({ providers: {}, secrets: {} });
    mocks.getJevSecret.mockReset().mockResolvedValue(undefined);
    mocks.saveJevDecisionPreferences.mockReset();
    mocks.setJevSecret.mockReset();
    mocks.getCore.mockReset();
    registerDecisionPlaneHandlers();
  });

  afterEach(() => vi.unstubAllGlobals());

  it('rejects synthetic malformed draft keys before reading stored configuration or starting fetch', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchImpl);
    const testApi = mocks.handlers.get('ax:testJevDecisionApi')!;

    for (const apiKey of ['synthetic\uD55C\uAE00', 'synthetic\nkey', ' synthetic-key', 'synthetic-key ', 'synthetic key']) {
      await expect(testApi({}, { apiKey })).rejects.toThrow('API 키 형식이 올바르지 않아요. 띄어쓰기나 줄바꿈 없이 발급받은 그대로 붙여 넣어 주세요.');
    }

    expect(mocks.readAiToml).not.toHaveBeenCalled();
    expect(mocks.getJevSecret).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(mocks.setJevSecret).not.toHaveBeenCalled();
  });

  it('does not save a malformed key or normalize surrounding whitespace', async () => {
    const saveConfig = mocks.handlers.get('ax:saveJevDecisionConfig')!;

    await expect(saveConfig({}, { enabled: false, apiKey: ' synthetic-key ' }))
      .rejects.toThrow('API 키 형식이 올바르지 않아요. 띄어쓰기나 줄바꿈 없이 발급받은 그대로 붙여 넣어 주세요.');

    expect(mocks.setJevSecret).not.toHaveBeenCalled();
    expect(mocks.saveJevDecisionPreferences).not.toHaveBeenCalled();
  });

  it('never sends a stored key to a Base URL origin it was not entered for', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchImpl);
    mocks.readAiToml.mockResolvedValue({
      providers: {}, secrets: {},
      decision: { jev: { enabled: true, baseURL: 'https://api.typesafe.ai', keyOrigin: 'https://api.typesafe.ai' } },
    });
    mocks.getJevSecret.mockResolvedValue('synthetic-key');

    await expect(mocks.handlers.get('ax:testJevDecisionApi')!({}, { baseURL: 'https://evil.example' }))
      .rejects.toThrow(/API 키를 다시 입력/);
    await expect(mocks.handlers.get('ax:saveJevDecisionConfig')!({}, { enabled: true, baseURL: 'https://evil.example' }))
      .rejects.toThrow(/API 키를 다시 입력/);

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(mocks.saveJevDecisionPreferences).not.toHaveBeenCalled();
    expect(mocks.getCore).not.toHaveBeenCalled();
  });

  it('binds a newly entered key to the origin it is saved with', async () => {
    const refreshDecisionEngine = vi.fn();
    mocks.getCore.mockReturnValue({ refreshDecisionEngine });
    mocks.getJevSecret.mockResolvedValue('synthetic-key');

    await mocks.handlers.get('ax:saveJevDecisionConfig')!({}, {
      enabled: true, baseURL: 'https://jev.example/v1/', apiKey: 'synthetic-key',
    });

    expect(mocks.setJevSecret).toHaveBeenCalledWith('synthetic-key');
    expect(mocks.saveJevDecisionPreferences).toHaveBeenCalledWith(expect.objectContaining({
      baseURL: 'https://jev.example/v1', keyOrigin: 'https://jev.example',
    }));
    expect(refreshDecisionEngine).toHaveBeenCalledOnce();
  });

  it('treats a legacy key as bound to the Base URL it was last saved with', async () => {
    mocks.getCore.mockReturnValue({ refreshDecisionEngine: vi.fn() });
    mocks.readAiToml.mockResolvedValue({ providers: {}, secrets: {}, decision: { jev: { baseURL: 'https://jev.example' } } });
    mocks.getJevSecret.mockResolvedValue('synthetic-key');

    await mocks.handlers.get('ax:saveJevDecisionConfig')!({}, { enabled: true, baseURL: 'https://jev.example/v2' });
    expect(mocks.saveJevDecisionPreferences).toHaveBeenCalledWith(expect.objectContaining({ keyOrigin: 'https://jev.example' }));
    await expect(mocks.handlers.get('ax:saveJevDecisionConfig')!({}, { enabled: true }))
      .rejects.toThrow(/API 키를 다시 입력/);
  });

  it('remembers a passed connection check, so settings do not ask again at every start', async () => {
    const getConfig = mocks.handlers.get('ax:getJevDecisionConfig')!;
    mocks.getJevSecret.mockResolvedValue('synthetic-key');
    mocks.readAiToml.mockResolvedValue({ providers: {}, secrets: {}, decision: { jev: { enabled: true, baseURL: 'https://api.typesafe.ai', keyOrigin: 'https://api.typesafe.ai' } } });
    expect(await getConfig({})).toMatchObject({ apiKeyConfigured: true, apiKeyVerified: false });

    const testApi = mocks.handlers.get('ax:testJevDecisionApi')!;
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ model: 'jev-1.13.0', answers: { reachable: { type: 'noul', noul: 0.99 } } }), {
      status: 200, headers: { 'content-type': 'application/json' },
    })));
    await testApi({}, {});
    expect(mocks.saveJevDecisionPreferences).toHaveBeenCalledWith({ verifiedKey: 'synthetic-mask' });

    // The next start reads it back.
    mocks.readAiToml.mockResolvedValue({ providers: {}, secrets: {}, decision: { jev: { enabled: true, baseURL: 'https://api.typesafe.ai', keyOrigin: 'https://api.typesafe.ai', verifiedKey: 'synthetic-mask' } } });
    expect(await getConfig({})).toMatchObject({ apiKeyVerified: true });
  });

  it('says a busy server is not the key or the address', async () => {
    mocks.getJevSecret.mockResolvedValue('synthetic-key');
    mocks.readAiToml.mockResolvedValue({ providers: {}, secrets: {}, decision: { jev: { enabled: true, baseURL: 'https://api.typesafe.ai', keyOrigin: 'https://api.typesafe.ai' } } });
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => new Response('unavailable', { status: 503 })));
    const testApi = mocks.handlers.get('ax:testJevDecisionApi')!;
    const error = await (testApi({}, {}) as Promise<unknown>).catch((caught: unknown) => caught as Error);
    expect((error as Error).message).toContain('응답하지 못하고 있어요(오류 503)');
    expect((error as Error).message).toContain('API 키나 주소 문제는 아니니');
    expect(mocks.saveJevDecisionPreferences).not.toHaveBeenCalled();
  }, 15_000);
});
