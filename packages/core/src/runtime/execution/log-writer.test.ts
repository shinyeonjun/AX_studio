import { describe, expect, it, vi } from 'vitest';
import type { ExecutionLogEntry } from '../../connectors/types.js';
import { createExecutionLogWriter } from './log-writer.js';

const entry = (code: string): ExecutionLogEntry => ({ at: '2026-10-06T00:00:00.000Z', level: 'info', code, message: code });

function fakeStore(appendResult = true) {
  return {
    updateExecutionLog: vi.fn(),
    appendExecutionLog: vi.fn(() => appendResult),
  };
}

describe('createExecutionLogWriter', () => {
  it('rewrites the full log first, then appends only new entries', () => {
    const store = fakeStore();
    const log: ExecutionLogEntry[] = [];
    const append = createExecutionLogWriter(store, 'exec_1', log);
    append(entry('a'));
    append(entry('b'));
    expect(store.updateExecutionLog).toHaveBeenCalledTimes(1);
    expect(store.appendExecutionLog).toHaveBeenCalledWith('exec_1', [entry('b')]);
  });

  it('falls back to a full rewrite when entries were pushed elsewhere or append fails', () => {
    const store = fakeStore();
    const log: ExecutionLogEntry[] = [];
    const append = createExecutionLogWriter(store, 'exec_1', log, 0);
    append(entry('a'));
    expect(store.appendExecutionLog).toHaveBeenCalledTimes(1);
    log.push(entry('silent'));
    append(entry('b'));
    expect(store.updateExecutionLog).toHaveBeenLastCalledWith('exec_1', [entry('a'), entry('silent'), entry('b')]);

    const failing = fakeStore(false);
    const other: ExecutionLogEntry[] = [];
    createExecutionLogWriter(failing, 'exec_2', other, 0)(entry('x'));
    expect(failing.updateExecutionLog).toHaveBeenCalledWith('exec_2', [entry('x')]);
  });
});
