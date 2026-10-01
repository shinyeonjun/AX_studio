import { EventEmitter, getEventListeners } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ child: undefined as any, active: new Set<any>() }));
vi.mock('node:child_process', async original => ({
  ...await original<typeof import('node:child_process')>(), spawn: vi.fn(() => state.child),
}));
vi.mock('./ownership.js', () => ({
  commandProcesses: {
    assertAccepting() {},
    track(child: any) { state.active.add(child); child.once('close', () => state.active.delete(child)); },
  },
  terminateOwnedChild: vi.fn((child: any, force?: boolean) => child.kill(force ? 'SIGKILL' : 'SIGTERM')),
}));
import { runCommandStreaming } from './stream.js';

function start(options = {}, stdinError?: Error) {
  state.child = Object.assign(new EventEmitter(), {
    pid: 123456, exitCode: null, signalCode: null,
    stdin: Object.assign(new EventEmitter(), { end: vi.fn(() => { if (stdinError) throw stdinError; }) }),
    stdout: new EventEmitter(), stderr: new EventEmitter(), kill: vi.fn(() => true),
  });
  return runCommandStreaming(process.execPath, [], options);
}

afterEach(() => {
  state.child?.emit('close', 1, null);
  state.active.clear();
  vi.useRealTimers();
});

describe('command resource cleanup', () => {
  it('terminates a live child when writing input throws synchronously', async () => {
    vi.useFakeTimers();
    const result = start({}, new Error('synthetic_stdin_failure')).catch(error => error);
    expect(state.child.kill).toHaveBeenCalledTimes(1);
    expect(state.active.size).toBe(1);
    state.child.emit('close', 1, null);
    expect(await result).toMatchObject({ message: 'synthetic_stdin_failure' });
    expect(state.active.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(state.child.stdin.listenerCount('error')).toBe(0);
  });
  it('terminates a still-running child on error and waits for close', async () => {
    vi.useFakeTimers();
    let settled = false;
    const result = start().catch(error => { settled = true; return error; });
    state.child.emit('error', new Error('synthetic_live_child_error'));
    await Promise.resolve();
    expect(state.child.kill).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);
    expect(state.active.size).toBe(1);
    state.child.emit('close', null, 'SIGTERM');
    expect(await result).toMatchObject({ message: 'synthetic_live_child_error' });
    expect(state.active.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('removes only runner listeners after each of 60 successful commands', async () => {
    const signal = new AbortController().signal;
    for (let index = 0; index < 60; index++) {
      const result = start({ abortSignal: signal });
      const observer = vi.fn();
      state.child.stdout.on('data', observer);
      state.child.stdout.emit('data', Buffer.from('synthetic'));
      state.child.emit('close', 0, null);
      expect(await result).toMatchObject({ stdout: 'synthetic', exitCode: 0 });
      expect(state.child.stdout.listeners('data')).toEqual([observer]);
      expect(state.child.stderr.listenerCount('data')).toBe(0);
      expect(state.child.stdin.listenerCount('error')).toBe(0);
      expect(state.child.listenerCount('close')).toBe(0);
      expect(getEventListeners(signal, 'abort')).toHaveLength(0);
      expect(state.active.size).toBe(0);
    }
  });

  it('releases reader callbacks and timers even when termination is not acknowledged', async () => {
    vi.useFakeTimers();
    const signal = new AbortController().signal;
    const result = start({ abortSignal: signal, timeoutMs: 10 }).catch(error => error);
    state.child.stdout.emit('data', Buffer.alloc(512 * 1024, 65));
    await vi.advanceTimersByTimeAsync(5_010);
    expect(await result).toMatchObject({ code: 'command_termination_failed' });
    expect(state.child.stdout.listenerCount('data')).toBe(0);
    expect(state.child.stderr.listenerCount('data')).toBe(0);
    expect(state.child.stdin.listenerCount('error')).toBe(0);
    expect(getEventListeners(signal, 'abort')).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
    // Ownership remains until close; disposing callbacks must not lose the child.
    expect(state.active.size).toBe(1);
    state.child.emit('close', null, 'SIGKILL');
    expect(state.active.size).toBe(0);
  });
});
