import { describe, expect, it } from 'vitest';
import { formatSlackSocketError } from './socket-mode.js';

describe('formatSlackSocketError', () => {
  it('keeps the SDK wrapper and its original transport error', () => {
    const original = new Error('ECONNRESET');
    const wrapped = new Error('', { cause: original });
    Object.assign(wrapped, { original });

    expect(formatSlackSocketError(wrapped)).toBe('ECONNRESET');
  });

  it('uses a useful fallback when the SDK error has no message', () => {
    const error = new Error();

    expect(formatSlackSocketError(error)).toBe('Error');
  });
});
