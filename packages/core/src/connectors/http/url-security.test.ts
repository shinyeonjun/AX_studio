import { describe, expect, it } from 'vitest';
import { isPrivateHttpHostname, resolveHttpRequestUrl } from './url-security.js';

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

  it.each([
    '127.0.0.1', '::1', '::ffff:127.0.0.1', '192.168.1.10',
    'localhost.', 'svc.internal', '[::1]', '0.0.0.0', '10.1.2.3', '100.64.0.1', '100.127.255.255',
    '127.255.255.254', '169.254.169.254', '172.16.0.1', '172.31.255.255', '192.0.0.8', '198.18.0.1',
    '198.19.255.255', '224.0.0.1', '239.255.255.250', '240.0.0.1', '255.255.255.255',
    '::', '[::ffff:7f00:1]', '::ffff:a9fe:a9fe', '::7f00:1', '::127.0.0.1', '0:0:0:0:0:ffff:7f00:1',
    '64:ff9b::7f00:1', '64:ff9b::10.0.0.1', '64:ff9b:1::1', '2002:7f00:1::', 'fc00::1', 'fd12:3456::1',
    'fe80::1', 'fe80::1%eth0', 'febf::1', 'ff02::1', 'fec0::1',
  ])('recognizes private destinations: %s', (hostname) => {
    expect(isPrivateHttpHostname(hostname)).toBe(true);
  });

  it.each([
    'api.example.com', '8.8.8.8', '100.63.255.255', '100.128.0.1', '172.15.255.255', '172.32.0.1',
    '192.0.1.1', '198.17.255.255', '198.20.0.1', '203.0.113.10', '2001:4860:4860::8888',
    '::ffff:808:808', '64:ff9b::808:808', '2002:808:808::', 'fbff::1', 'fe7f::1',
  ])('allows public destinations: %s', (hostname) => {
    expect(isPrivateHttpHostname(hostname)).toBe(false);
  });

  it('checks the WHATWG-normalized hostname of hex/shorthand IPv4 literals', () => {
    expect(isPrivateHttpHostname(new URL('http://0x7f.1/').hostname)).toBe(true);
    expect(isPrivateHttpHostname(new URL('http://2130706433/').hostname)).toBe(true);
    expect(isPrivateHttpHostname(new URL('http://[::ffff:127.0.0.1]/').hostname)).toBe(true);
  });
});
