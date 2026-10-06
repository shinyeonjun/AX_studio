import { describe, expect, it } from 'vitest';
import { withHttpConnectionLock } from './lock.js';

describe('withHttpConnectionLock', () => {
  it('runs critical sections one at a time, even after a failure', async () => {
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const first = withHttpConnectionLock(async () => {
      order.push('first:start');
      await gate;
      order.push('first:end');
      throw new Error('boom');
    });
    const second = withHttpConnectionLock(async () => {
      order.push('second');
      return 2;
    });
    release();
    await expect(first).rejects.toThrow('boom');
    await expect(second).resolves.toBe(2);
    expect(order).toEqual(['first:start', 'first:end', 'second']);
  });
});
