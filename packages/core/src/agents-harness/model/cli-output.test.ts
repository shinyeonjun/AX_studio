import { describe, expect, it } from 'vitest';
import { isCursorNoiseLine, readableCliError, pickCliOutput } from './cli/output.js';

describe('cursor cli stderr filtering', () => {
  it('treats cursor-retrieval tracing as noise', () => {
    expect(isCursorNoiseLine("cursor-retrieval: tracing to 'C:\\Temp\\cursor_retrieval.log'")).toBe(true);
    expect(readableCliError("cursor-retrieval: tracing to 'C:\\Temp\\cursor_retrieval.log'", 'fail')).toBe('fail');
  });

  it('keeps real errors after filtering noise', () => {
    const stderr = "cursor-retrieval: tracing to log\nAuthentication required";
    expect(readableCliError(stderr, 'fail')).toBe('Authentication required');
  });

  it('prefers stdout over filtered stderr', () => {
    const picked = pickCliOutput({
      stdout: '{"ok":true}',
      stderr: "cursor-retrieval: tracing to log",
    });
    expect(picked).toBe('{"ok":true}');
  });
});
