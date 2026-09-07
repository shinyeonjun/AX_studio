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

  it.each(['users%2F..%2Fadmin', 'users%2f..%2fadmin', 'users%5C..%5Cadmin'])(
    'blocks encoded path separators that a server could decode: %s',
    (path) => {
      const result = resolveHttpRequestUrl(base, path);
      expect(result).toEqual({
        ok: false,
        error: 'encoded_path_separator_not_allowed',
        errorCode: 'ssrf_blocked',
      });
    },
  );

  it('allows percent-encoded path content that cannot change path boundaries', () => {
    const result = resolveHttpRequestUrl(base, 'caf%C3%A9');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.url).toBe('https://api.example.com/v1/caf%C3%A9');
    }
  });

  it('allows encoded separators in query values', () => {
    const result = resolveHttpRequestUrl(base, 'search?path=docs%2Fguide');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.url).toBe('https://api.example.com/v1/search?path=docs%2Fguide');
    }
  });

  it('rejects unsupported base protocols', () => {
    const result = resolveHttpRequestUrl('file:///tmp', 'x');
    expect(result.ok).toBe(false);
  });
});
