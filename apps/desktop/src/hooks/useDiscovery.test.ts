import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const stateSetters = vi.hoisted(() => Array.from({ length: 5 }, () => vi.fn()));
const hookState = vi.hoisted(() => ({ setterIndex: 0 }));

vi.mock('react', () => ({
  useCallback: <T>(callback: T) => callback,
  useEffect: vi.fn(),
  useRef: <T>(initial: T) => ({ current: initial }),
  useState: (_initial: unknown) => {
    const setter = stateSetters[hookState.setterIndex++];
    if (!setter) throw new Error('Unexpected useState call');
    return [_initial, setter];
  },
}));

import { useDiscovery } from './useDiscovery';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

describe('useDiscovery refresh ordering', () => {
  const originalWindow = globalThis.window;

  beforeEach(() => {
    stateSetters.splice(0, stateSetters.length, vi.fn(), vi.fn(), vi.fn(), vi.fn(), vi.fn());
    hookState.setterIndex = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
  });

  it('ignores an older inspection that resolves after the latest request', async () => {
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    const discoveryInspect = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        ax: {
          importArtifact: vi.fn().mockResolvedValue({ ok: true, artifact: { id: 'artifact-1' } }),
          discoveryStart: vi.fn().mockResolvedValue({ status: 'ok', data: { sessionId: 'session-1' } }),
          discoveryInspect,
        },
      },
    });

    const { importAndStart } = useDiscovery();
    const firstStart = importAndStart('goal');
    await vi.waitFor(() => expect(discoveryInspect).toHaveBeenCalledOnce());
    const secondStart = importAndStart('goal');
    await vi.waitFor(() => expect(discoveryInspect).toHaveBeenCalledTimes(2));

    const latestView = { status: 'clarifying', revision: 2 };
    second.resolve({ status: 'ok', data: latestView });
    await secondStart;
    expect(stateSetters[2]).toHaveBeenCalledWith(latestView);

    first.resolve({ status: 'ok', data: { status: 'observing', revision: 1 } });
    await firstStart;

    expect(stateSetters[2]).toHaveBeenCalledTimes(1);
  });
});
