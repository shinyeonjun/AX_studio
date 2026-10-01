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
    registerDecisionPlaneHandlers();
  });

  afterEach(() => vi.unstubAllGlobals());

  it('rejects synthetic malformed draft keys before reading stored configuration or starting fetch', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchImpl);
    const testApi = mocks.handlers.get('ax:testJevDecisionApi')!;

    for (const apiKey of ['synthetic\uD55C\uAE00', 'synthetic\nkey', ' synthetic-key', 'synthetic-key ', 'synthetic key']) {
      await expect(testApi({}, { apiKey })).rejects.toThrow(/ASCII bearer tokens/);
    }

    expect(mocks.readAiToml).not.toHaveBeenCalled();
    expect(mocks.getJevSecret).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(mocks.setJevSecret).not.toHaveBeenCalled();
  });

  it('does not save a malformed key or normalize surrounding whitespace', async () => {
    const saveConfig = mocks.handlers.get('ax:saveJevDecisionConfig')!;

    await expect(saveConfig({}, { enabled: false, apiKey: ' synthetic-key ' }))
      .rejects.toThrow(/ASCII bearer tokens/);

    expect(mocks.setJevSecret).not.toHaveBeenCalled();
    expect(mocks.saveJevDecisionPreferences).not.toHaveBeenCalled();
  });
});
