import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const settings = new Map<string, unknown>();
  const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();
  return { settings, handlers };
});
vi.mock('../ipc/ipc-handle.js', () => ({ ipcHandle: (channel: string, handler: (...args: unknown[]) => Promise<unknown>) => mocks.handlers.set(channel, handler) }));
vi.mock('../core-instance.js', () => ({ getCore: () => ({ store: {
  getSetting: (key: string, fallback: unknown) => (mocks.settings.has(key) ? mocks.settings.get(key) : fallback),
  setSetting: (key: string, value: unknown) => mocks.settings.set(key, value),
} }) }));

import { KEEP_CONTENT_LOCAL_SETTING } from '@ax-studio/core';
import { registerPrivacyHandlers } from './ipc.js';

describe('keeping work content on this computer', () => {
  it('is off until chosen, and remembers the choice in the setting the runtime reads', async () => {
    registerPrivacyHandlers();
    expect(await mocks.handlers.get('ax:getKeepContentLocal')!()).toBe(false);
    expect(await mocks.handlers.get('ax:setKeepContentLocal')!({}, true)).toBe(true);
    expect(mocks.settings.get(KEEP_CONTENT_LOCAL_SETTING)).toBe(true);
    expect(await mocks.handlers.get('ax:getKeepContentLocal')!()).toBe(true);
    await expect(mocks.handlers.get('ax:setKeepContentLocal')!({}, 'yes')).rejects.toThrow();
  });
});
