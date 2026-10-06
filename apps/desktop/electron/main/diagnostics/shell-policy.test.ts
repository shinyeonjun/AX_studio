import { describe, expect, it } from 'vitest';
import { externalHttpsUrl, isRendererPermissionAllowed } from './shell-policy.js';

describe('externalHttpsUrl', () => {
  it.each([
    ['https://example.com/docs?q=1#a', 'https://example.com/docs?q=1#a'],
    ['https://例え.jp/', 'https://xn--r8jz45g.jp/'],
  ])('allows %s', (input, expected) => {
    expect(externalHttpsUrl(input)).toBe(expected);
  });

  it.each([
    'http://example.com',
    'file:///C:/Windows/System32/calc.exe',
    'javascript:alert(1)',
    'mailto:a@example.com',
    'ms-settings:',
    'https://user:pass@example.com',
    'not a url',
    42,
    `https://example.com/${'a'.repeat(5_000)}`,
  ])('rejects %s', (input) => {
    expect(externalHttpsUrl(input)).toBeNull();
  });
});

describe('isRendererPermissionAllowed', () => {
  const trusted = (url: string) => url.startsWith('file:///app/index.html');

  it('allows sanitized clipboard writes from the trusted renderer only', () => {
    expect(isRendererPermissionAllowed('clipboard-sanitized-write', 'file:///app/index.html#/', trusted)).toBe(true);
    expect(isRendererPermissionAllowed('clipboard-sanitized-write', 'https://evil.example', trusted)).toBe(false);
    expect(isRendererPermissionAllowed('clipboard-sanitized-write', undefined, trusted)).toBe(false);
  });

  it.each(['media', 'geolocation', 'notifications', 'clipboard-read', 'openExternal', 'hid', 'serial', 'usb', 'fullscreen'])(
    'denies %s',
    (permission) => {
      expect(isRendererPermissionAllowed(permission, 'file:///app/index.html', trusted)).toBe(false);
    },
  );
});
