/**
 * Most Linux/macOS file systems cap one path component at 255 *bytes*, and a Hangul syllable is
 * 3 UTF-8 bytes, so a character cap alone lets Korean names fail with ENAMETOOLONG. Keep names
 * under this byte budget (headroom for id prefixes) as well as any character cap.
 */
export const MAX_FILE_NAME_UTF8_BYTES = 180;

/** Longest prefix of `text` that fits in `maxBytes` UTF-8 bytes, cut on whole code points. */
export function truncateToUtf8Bytes(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return text;
  let used = 0;
  let result = '';
  for (const char of text) {
    const size = Buffer.byteLength(char, 'utf8');
    if (used + size > maxBytes) break;
    used += size;
    result += char;
  }
  return result;
}
