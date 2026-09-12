import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const stateSetters = vi.hoisted(() => Array.from({ length: 3 }, () => vi.fn()));
const hookState = vi.hoisted(() => ({ setterIndex: 0 }));
const effects = vi.hoisted(() => [] as Array<() => void | (() => void)>);
let onStateChanged: (() => void) | undefined;

vi.mock('react', () => ({
  useCallback: <T>(callback: T) => callback,
  useEffect: (effect: () => void | (() => void)) => effects.push(effect),
  useRef: <T>(initial: T) => ({ current: initial }),
  useState: (_initial: unknown) => {
    const setter = stateSetters[hookState.setterIndex++];
    if (!setter) throw new Error('Unexpected useState call');
    return [_initial, setter];
  },
}));

import { useAppState } from './useAppState';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

async function startOverlappingRefreshes(first: Promise<unknown>, second: Promise<unknown>, notification = false) {
  const getState = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second);
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      ax: {
        getState,
        onStateChanged: (listener: () => void) => {
          onStateChanged = listener;
          return vi.fn();
        },
      },
    },
  });

  const { refresh } = useAppState();
  effects[0]?.();
  await Promise.resolve();
  if (notification) onStateChanged?.();
  else void refresh();
  expect(getState).toHaveBeenCalledOnce();
  return stateSetters;
}

describe('useAppState refresh ordering', () => {
  const originalWindow = globalThis.window;

  beforeEach(() => {
    stateSetters.splice(0, stateSetters.length, vi.fn(), vi.fn(), vi.fn());
    hookState.setterIndex = 0;
    effects.length = 0;
    onStateChanged = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
  });

  it('keeps a ready snapshot usable while a background refresh is pending', async () => {
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    const [, setLoadState] = await startOverlappingRefreshes(first.promise, second.promise);
    const pendingUpdate = setLoadState.mock.calls[0]![0] as (state: string) => string;
    expect(pendingUpdate('ready')).toBe('ready');
    first.resolve({});
    second.resolve({});
  });

  it('serializes refreshes and suppresses success invalidated by a newer request', async () => {
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    const [setState, setLoadState, setError] = await startOverlappingRefreshes(first.promise, second.promise);
    const latestState = { workflows: [{ id: 'latest' }] };
    first.resolve({ workflows: [{ id: 'stale' }] });
    await first.promise;
    expect(setState).not.toHaveBeenCalled();
    second.resolve(latestState);
    await second.promise;
    await vi.waitFor(() => expect(setState).toHaveBeenCalledWith(latestState));


    expect(setState).toHaveBeenCalledTimes(1);
    expect(setLoadState).toHaveBeenLastCalledWith('ready');
    expect(setError).toHaveBeenLastCalledWith('');
  });

  it('suppresses an invalidated failure and then applies the trailing success', async () => {
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    const [setState, setLoadState, setError] = await startOverlappingRefreshes(first.promise, second.promise);
    first.reject(new Error('stale failure'));
    await expect(first.promise).rejects.toThrow('stale failure');
    expect(setError).not.toHaveBeenCalled();
    second.resolve({ workflows: [{ id: 'latest' }] });
    await second.promise;
    await vi.waitFor(() => expect(setState).toHaveBeenCalledOnce());


    expect(setLoadState).toHaveBeenLastCalledWith('ready');
    expect(setError).toHaveBeenLastCalledWith('');
  });

  it('keeps serialized results visible while passive notifications queue another read', async () => {
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    const [setState] = await startOverlappingRefreshes(first.promise, second.promise, true);
    for (let i = 0; i < 100; i++) onStateChanged?.();
    const initialState = { workflows: [{ id: 'initial' }] };
    first.resolve(initialState);
    await vi.waitFor(() => expect(setState).toHaveBeenCalledWith(initialState));
    const latestState = { workflows: [{ id: 'latest' }] };
    second.resolve(latestState);
    await vi.waitFor(() => expect(setState).toHaveBeenLastCalledWith(latestState));
    expect(setState).toHaveBeenCalledTimes(2);
  });
});
