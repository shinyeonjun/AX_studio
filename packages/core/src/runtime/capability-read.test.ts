import { describe, expect, it, vi } from 'vitest';
import { performCapabilityRead } from './capability-read.js';

describe('runtime capability read boundary', () => {
  it('does not let AI investigation turn a read capability into a POST', async () => {
    const execute = vi.fn(async () => ({ ok: true, data: { unexpected: true } }));
    const result = await performCapabilityRead(
      'http.request',
      { executionId: 'investigation-1', variables: {}, log: vi.fn() },
      { http: { name: 'http', execute } },
      { method: 'POST', path: 'tickets', body: '{}' },
    );

    expect(result).toBeNull();
    expect(execute).not.toHaveBeenCalled();
  });
});
