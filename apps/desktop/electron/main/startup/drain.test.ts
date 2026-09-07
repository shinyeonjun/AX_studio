import { afterEach, expect, it, vi } from 'vitest';
import { drainWithin } from './drain.js';
afterEach(() => vi.useRealTimers());
it('bounds a stuck first stage and still starts the other drains', async () => {
  vi.useFakeTimers(); const later = vi.fn(async () => {});
  const result = drainWithin([() => new Promise(() => {}), later], 50);
  await vi.advanceTimersByTimeAsync(50);
  expect(await result).toBe(false); expect(later).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});
it('waits for all stages and clears the deadline after success', async () => {
  vi.useFakeTimers(); expect(await drainWithin([async () => {}, async () => true], 50)).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
  expect(await drainWithin([async () => { throw new Error('failed'); }], 50)).toBe(false);
});
