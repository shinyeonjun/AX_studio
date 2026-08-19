import { describe, expect, it } from 'vitest';
import { isCursorNoiseLine, readableCliError, pickCliOutput, parseCursorStreamLine, cursorSessionIdFromEvent, cursorProgressFromEvent, cursorResultTextFromEvent, cliFailureMessage } from './cli/output.js';

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

  it('surfaces non-zero exit stdout error without json parse noise', () => {
    const message = cliFailureMessage(
      {
        exitCode: 1,
        stdout: 'Error: Sandbox mode is enabled but not available',
        stderr: 'cursor-retrieval: tracing to log',
      },
      'fail',
    );
    expect(message).toBe('Error: Sandbox mode is enabled but not available');
  });
});

describe('cursor stream-json events', () => {
  it('extracts session id, progress, and result text', () => {
    const init = parseCursorStreamLine('{"type":"system","session_id":"abc"}');
    expect(init && cursorSessionIdFromEvent(init)).toBe('abc');
    expect(init && cursorProgressFromEvent(init)).toContain('준비');

    const result = parseCursorStreamLine('{"type":"result","result":"{\\"ok\\":true}","session_id":"abc"}');
    expect(result && cursorResultTextFromEvent(result)).toBe('{"ok":true}');
  });
});
