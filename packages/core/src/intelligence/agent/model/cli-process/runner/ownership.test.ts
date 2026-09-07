import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { afterEach, expect, it, vi } from 'vitest';
import { CommandProcessRegistry } from './ownership.js';
afterEach(() => vi.useRealTimers());
it('drains only owned children and closes admission on shutdown', async () => {
  const registry = new CommandProcessRegistry();
  const child = Object.assign(new EventEmitter(), { kill: vi.fn(), pid: undefined }) as unknown as ChildProcess;
  registry.track(child);
  let done = false;
  const drain = registry.shutdown().then(result => { done = true; return result; });
  await Promise.resolve(); expect(done).toBe(false);
  expect(() => registry.assertAccepting()).toThrow('command_host_stopping');
  child.emit('close', null, 'SIGTERM'); expect(await drain).toBe(true);
});
it('reports a drain deadline and escalates without claiming termination', async () => {
  vi.useFakeTimers();
  const registry = new CommandProcessRegistry();
  const child = Object.assign(new EventEmitter(), { kill: vi.fn(), pid: undefined }) as unknown as ChildProcess;
  registry.track(child); const drain = registry.shutdown(20);
  await vi.advanceTimersByTimeAsync(20);
  expect(await drain).toBe(false); expect(child.kill).toHaveBeenLastCalledWith('SIGKILL');
  child.emit('close', null, 'SIGKILL'); expect(vi.getTimerCount()).toBe(0);
});
