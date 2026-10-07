import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reloadOnStateChange } from './reload-on-state-change';

let broadcast: (() => void) | undefined;
const unsubscribe = vi.fn();

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

beforeEach(() => {
  broadcast = undefined;
  unsubscribe.mockReset();
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { ax: { onStateChanged: (listener: () => void) => { broadcast = listener; return unsubscribe; } } },
  });
});

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'window');
});

describe('reloading a tool result card on state broadcasts', () => {
  it('loads once at start and runs one follow-up for a burst of broadcasts', async () => {
    const first = deferred<void>();
    const load = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(undefined);
    const stop = reloadOnStateChange(load);
    expect(load).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 50; i++) broadcast?.();
    expect(load).toHaveBeenCalledTimes(1);
    first.resolve();
    await flush();
    expect(load).toHaveBeenCalledTimes(2);
    broadcast?.();
    await flush();
    expect(load).toHaveBeenCalledTimes(3);
    stop();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('stops listening once a load reports a final result', async () => {
    const load = vi.fn().mockResolvedValue(true);
    const stop = reloadOnStateChange(load);
    await flush();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    broadcast?.();
    await flush();
    expect(load).toHaveBeenCalledTimes(1);
    stop();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('keeps listening after a failed load and loads nothing after stop', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
    const stop = reloadOnStateChange(load);
    await flush();
    broadcast?.();
    await flush();
    expect(load).toHaveBeenCalledTimes(2);
    stop();
    broadcast?.();
    await flush();
    expect(load).toHaveBeenCalledTimes(2);
  });
});
