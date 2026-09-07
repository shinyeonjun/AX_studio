import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ child: undefined as any }));
vi.mock('node:child_process', async original => ({
  ...await original<typeof import('node:child_process')>(), spawn: vi.fn(() => state.child),
}));
import { runCommandStreaming } from './stream.js';

function start(options = {}) {
  state.child = Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(), stderr: new EventEmitter(), exitCode: null, kill: vi.fn(() => true),
  });
  return runCommandStreaming(process.execPath, [], options);
}
afterEach(() => vi.useRealTimers());
describe('streaming process ownership', () => {
  it('preserves UTF-8 characters split across pipe chunks', async () => {
    const result = start();
    const bytes = Buffer.from('한글');
    state.child.stdout.emit('data', bytes.subarray(0, 1));
    state.child.stdout.emit('data', bytes.subarray(1, 4));
    state.child.stdout.emit('data', bytes.subarray(4));
    state.child.emit('close', 0, null);
    expect((await result).stdout).toBe('한글');
  });
  it('uses close status, never treating signal termination as success', async () => {
    const result = start(); state.child.emit('close', null, 'SIGTERM');
    expect((await result).exitCode).not.toBe(0);
  });
  it('waits for close after cancellation and escalates a stuck child', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    let settled = false;
    const result = start({ abortSignal: controller.signal }).catch(error => { settled = true; return error; });
    controller.abort(); await Promise.resolve(); expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(state.child.kill).toHaveBeenLastCalledWith('SIGKILL');
    state.child.emit('close', null, 'SIGKILL');
    expect(await result).toMatchObject({ code: 'ABORT_ERR' });
    expect(vi.getTimerCount()).toBe(0);
  });
  it('reports unacknowledged termination instead of waiting forever', async () => {
    vi.useFakeTimers();
    const result = start({ timeoutMs: 10 }).catch(error => error);
    await vi.advanceTimersByTimeAsync(5_010);
    expect(await result).toMatchObject({ code: 'command_termination_failed' });
    state.child.emit('close', null, 'SIGKILL');
    expect(vi.getTimerCount()).toBe(0);
  });
});
