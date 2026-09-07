import { expect, it, vi } from 'vitest';
import { CoalescedRefresh } from './coalesced-refresh.js';
it('coalesces bursts into one current and one latest trailing request', async () => {
  const queue = new CoalescedRefresh<number>();
  let release!: (value: number) => void;
  const first = vi.fn(() => new Promise<number>(resolve => { release = resolve; }));
  const result = queue.run(first); await Promise.resolve();
  const discarded = vi.fn(async () => 2);
  for (let i = 0; i < 100; i++) queue.run(discarded);
  const latest = vi.fn(async () => 3); const joined = queue.run(latest);
  expect(latest).not.toHaveBeenCalled(); release(1);
  expect(await result).toBe(3); expect(await joined).toBe(3);
  expect(first).toHaveBeenCalledOnce(); expect(latest).toHaveBeenCalledOnce();
  expect(discarded).not.toHaveBeenCalled();
});
it('drops pending work on disposal and remains usable after failure', async () => {
  const queue = new CoalescedRefresh<number>();
  await expect(queue.run(async () => { throw new Error('failed'); })).rejects.toThrow('failed');
  const pending = vi.fn(async () => 1);
  const result = queue.run(pending); queue.clearPending(); await result;
  expect(pending).not.toHaveBeenCalled();
  expect(await queue.run(async () => 2)).toBe(2);
});
