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

    expect(body).toBe('Order update Your order has shipped.');
  });
});
