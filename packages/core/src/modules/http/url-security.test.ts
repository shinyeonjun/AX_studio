import { describe, expect, it } from 'vitest';
import { resolveHttpRequestUrl } from './url-security.js';

describe('resolveHttpRequestUrl', () => {
  const base = 'https://api.example.com/v1/';

  it('resolves a relative path under the base', () => {
    const result = resolveHttpRequestUrl(base, 'users');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.url).toBe('https://api.example.com/v1/users');
    }
  });

  it('blocks absolute URLs', () => {
    expect(resolveHttpRequestUrl(base, 'https://evil.com/x').ok).toBe(false);
    expect(resolveHttpRequestUrl(base, '//evil.com/x').ok).toBe(false);
  });

  it('blocks host-root paths that escape the base prefix', () => {
    const result = resolveHttpRequestUrl(base, '/../../v2/users');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe('ssrf_blocked');
    }
  });

  it('rejects unsupported base protocols', () => {
    const result = resolveHttpRequestUrl('file:///tmp', 'x');
    expect(result.ok).toBe(false);
  });
});
