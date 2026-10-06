/**
 * Pure policy decisions for the Electron shell: which external links may be
 * handed to the OS browser and which Chromium permissions the renderer gets.
 */

/**
 * Returns the normalized URL when it may be opened externally: `https:` only,
 * no embedded credentials. Hostnames come back in punycode so the confirmation
 * dialog shows look-alike (IDN homograph) domains as they really are.
 */
export function externalHttpsUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 4_096) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' || !parsed.hostname) return null;
  if (parsed.username || parsed.password) return null;
  return parsed.href;
}

/**
 * Chromium permissions the renderer may use. Copy buttons write sanitized
 * text to the clipboard; everything else (camera, mic, geolocation,
 * notifications, clipboard read, HID/serial/USB, ...) is denied.
 */
const RENDERER_PERMISSIONS: ReadonlySet<string> = new Set(['clipboard-sanitized-write']);

export function isRendererPermissionAllowed(
  permission: string,
  requestingUrl: string | undefined,
  isTrustedRendererUrl: (url: string) => boolean,
): boolean {
  if (!RENDERER_PERMISSIONS.has(permission)) return false;
  return typeof requestingUrl === 'string' && isTrustedRendererUrl(requestingUrl);
}
