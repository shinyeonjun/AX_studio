import { describe, expect, it } from 'vitest';
import { resolveHttpRequestUrl } from './url-security.js';

describe('HTTP base URL components', () => {
  it.each(['http://127.0.0.1/v1?lang=en', 'http://127.0.0.1/v1#docs'])('keeps the configured base pathname: %s', base => {
    expect(resolveHttpRequestUrl(base, 'items?page=2')).toMatchObject({
      ok: true, value: { url: 'http://127.0.0.1/v1/items?page=2' },
    });
  });

  it('allows an absolute URL as query data without treating it as the target', () => {
    expect(resolveHttpRequestUrl('http://127.0.0.1/v1/', 'items?source=https://example.invalid/'))
      .toMatchObject({ ok: true, value: { url: 'http://127.0.0.1/v1/items?source=https://example.invalid/' } });
  });
});
