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

  it('keeps the underlying TypeError visible when the SDK supplied no detail', () => {
    const error = Object.assign(new Error(), { original: new TypeError() });

    expect(formatSlackSocketError(error)).toBe(
      'TypeError (Slack WebSocket transport returned no diagnostic detail)',
    );
  });

  it('walks through nested transport causes and redacts tokens and signed URLs', () => {
    const transportCause = Object.assign(new Error('connect wss://example.test/socket failed for xapp-sensitive'), {
      code: 'ECONNREFUSED',
    });
    const transportError = Object.assign(new TypeError(), { cause: transportCause });
    const wrapped = Object.assign(new Error('', { cause: transportError }), { original: transportError });

    const detail = formatSlackSocketError(wrapped);

    expect(detail).toContain('ECONNREFUSED');
    expect(detail).toContain('[REDACTED_URL]');
    expect(detail).not.toContain('example.test');
    expect(detail).not.toContain('xapp-sensitive');
  });

  it('extracts a non-Error SDK payload instead of collapsing it to TypeError', () => {
    const error = Object.assign(new Error(), {
      original: {
        cause: { message: 'socket handshake failed', code: 'UND_ERR_CONNECT_TIMEOUT' },
      },
    });

    expect(formatSlackSocketError(error)).toContain('UND_ERR_CONNECT_TIMEOUT');
    expect(formatSlackSocketError(error)).toContain('socket handshake failed');
  });
});
