import { describe, expect, it } from 'vitest';
import { extractGmailPlainBody } from './body-extract.js';

function encoded(value: string): string {
  return Buffer.from(value).toString('base64url');
}

describe('extractGmailPlainBody', () => {
  it('excludes text attachments from a multipart message body', () => {
    const body = extractGmailPlainBody({
      payload: {
        mimeType: 'multipart/mixed',
        parts: [
          { mimeType: 'text/plain', body: { data: encoded('메일 본문') } },
          {
            mimeType: 'text/plain',
            filename: 'notes.txt',
            headers: [{ name: 'Content-Disposition', value: 'attachment; filename="notes.txt"' }],
            body: { data: encoded('첨부파일 내용') },
          },
        ],
      },
    });

    expect(body).toBe('메일 본문');
  });

  it('excludes unnamed parts marked as attachments', () => {
    const body = extractGmailPlainBody({
      payload: {
        mimeType: 'multipart/mixed',
        parts: [
          { mimeType: 'text/plain', body: { data: encoded('message body') } },
          {
            mimeType: 'text/plain',
            headers: [{ name: 'content-disposition', value: 'attachment' }],
            body: { data: encoded('attached text') },
          },
        ],
      },
    });

    expect(body).toBe('message body');
  });

  it('excludes script and style contents from an HTML-only body', () => {
    const body = extractGmailPlainBody({
      payload: {
        mimeType: 'text/html',
        body: {
          data: encoded(`
            <html>
              <head>
                <style>.hidden { display: none; }</style>
                <script>window.trackingId = 'secret';</script>
              </head>
              <body><h1>Order update</h1><p>Your order has shipped.</p></body>
            </html>
          `),
        },
      },
    });

    expect(body).toBe('Order update\nYour order has shipped.');
  });
});

describe('Korean and HTML mail bodies', () => {
  const b64url = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');

  it('decodes a euc-kr / ks_c_5601-1987 part by its declared charset', () => {
    // "한글" in EUC-KR.
    const hangul = new Uint8Array([0xc7, 0xd1, 0xb1, 0xdb]);
    for (const charset of ['euc-kr', 'ks_c_5601-1987', 'EUC-KR']) {
      const body = extractGmailPlainBody({ payload: {
        mimeType: 'text/plain', headers: [{ name: 'Content-Type', value: `text/plain; charset="${charset}"` }],
        body: { data: b64url(hangul) },
      } });
      expect(body).toBe('한글');
    }
  });

  it('turns HTML into readable lines with entities decoded', () => {
    const html = '<p>재고&nbsp;알림 &amp; 보고</p><div>A&lt;B</div>첫줄<br>둘째줄 &#54620;';
    const body = extractGmailPlainBody({ payload: {
      mimeType: 'text/html', headers: [{ name: 'Content-Type', value: 'text/html; charset=utf-8' }],
      body: { data: b64url(new TextEncoder().encode(html)) },
    } });
    expect(body).toBe('재고 알림 & 보고\nA<B\n첫줄\n둘째줄 한');
  });
});
