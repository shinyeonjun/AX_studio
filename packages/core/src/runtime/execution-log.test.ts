import { describe, expect, it } from 'vitest';
import { parseExecutionLog, executionLogCodes, hasExecutionLogCode } from './execution-log.js';

describe('execution-log', () => {
  it('parses stored JSON and extracts codes', () => {
    const log = parseExecutionLog(
      JSON.stringify([
        { at: '2026-01-01T00:00:00.000Z', level: 'error', code: 'http.request_failed', message: 'timeout' },
        { at: '2026-01-01T00:00:01.000Z', level: 'info', message: 'step_completed' },
      ]),
    );
    expect(executionLogCodes(log)).toEqual(['http.request_failed']);
    expect(hasExecutionLogCode(log, 'http.request_failed')).toBe(true);
  });

  it('returns empty array for malformed log JSON', () => {
    expect(parseExecutionLog('not-json')).toEqual([]);
  });
});
