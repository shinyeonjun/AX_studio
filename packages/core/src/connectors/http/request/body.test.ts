import { describe, expect, it } from 'vitest';
import { readBodyWithLimit } from './body.js';

const response = (bytes: Uint8Array, contentType?: string) =>
  new Response(bytes, { headers: contentType ? { 'content-type': contentType } : {} });

describe('reading an HTTP response body', () => {
  it('drops a UTF-8 byte-order mark so JSON still parses', async () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('{"ok":true}')]);
    const { body } = await readBodyWithLimit(response(bytes, 'application/json'), 1_000);
    expect(JSON.parse(body)).toEqual({ ok: true });
  });

  it('decodes the declared charset (EUC-KR)', async () => {
    const { body } = await readBodyWithLimit(response(new Uint8Array([0xc7, 0xd1, 0xb1, 0xdb]), 'text/plain; charset=EUC-KR'), 1_000);
    expect(body).toBe('한글');
  });

  it('never ends a cut body with half a character', async () => {
    const { body, truncated } = await readBodyWithLimit(response(new TextEncoder().encode('가나다'), 'text/plain; charset=utf-8'), 4);
    expect(truncated).toBe(true);
    expect(body).toBe('가');
  });
});
