import { afterEach, describe, expect, it, vi } from 'vitest';
import { getStoredTheme, storeTheme } from './useTheme';

const originalLocalStorage = globalThis.localStorage;
const originalWindow = globalThis.window;

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: originalLocalStorage,
  });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: originalWindow,
  });
});

describe('theme storage', () => {
  it('falls back to the system preference when storage reads are blocked', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: vi.fn(() => {
          throw new Error('blocked');
        }),
      },
    });
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { matchMedia: vi.fn(() => ({ matches: true })) },
    });

    expect(getStoredTheme()).toBe('dark');
  });

  it('does not fail when storage writes are blocked', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        setItem: vi.fn(() => {
          throw new Error('blocked');
        }),
      },
    });

    expect(() => storeTheme('light')).not.toThrow();
  });
});
