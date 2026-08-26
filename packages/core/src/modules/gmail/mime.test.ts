import { describe, expect, it } from 'vitest';
import { buildGmailRawMessage, buildPlainTextMime, encodeMimeHeaderValue } from './mime.js';

describe('gmail mime', () => {
  it('encodes Korean subject with RFC 2047', () => {
    const encoded = encodeMimeHeaderValue('테스트 메일');
    expect(encoded).toMatch(/^=\?UTF-8\?B\?/);
    expect(encoded).not.toContain('테스트');
  });

  it('builds UTF-8 plain text MIME with encoded subject and body', () => {
    const mime = buildPlainTextMime({
      to: 'plosind@naver.com',
      subject: '테스트 메일',
      body: '테스트 메일입니다.',
    });
    expect(mime).toContain('To: plosind@naver.com');
    expect(mime).toMatch(/Subject: =\?UTF-8\?B\?/);
    expect(mime).toContain('Content-Type: text/plain; charset=UTF-8');
    expect(mime).toContain('Content-Transfer-Encoding: base64');
    const bodyLine = mime.split('\r\n\r\n')[1]?.trim();
    expect(Buffer.from(bodyLine ?? '', 'base64').toString('utf8')).toBe('테스트 메일입니다.');
  });

  it('round-trips through base64url raw encoding', () => {
    const raw = buildGmailRawMessage({
      to: 'a@b.com',
      subject: '한글 제목',
      body: '본문 내용',
    });
    const decoded = Buffer.from(raw, 'base64url').toString('utf8');
    expect(decoded).toContain('charset=UTF-8');
    expect(decoded).toMatch(/Subject: =\?UTF-8\?B\?/);
  });

  it.each([
    ['to', { to: 'victim@example.com\r\nBcc: attacker@example.com', subject: 'Notice' }],
    ['from', { to: 'victim@example.com', from: 'sender@example.com\nBcc: attacker@example.com', subject: 'Notice' }],
    ['subject', { to: 'victim@example.com', subject: 'Notice\r\nBcc: attacker@example.com' }],
  ])('rejects line breaks in the %s header', (header, params) => {
    expect(() => buildPlainTextMime({ ...params, body: 'Body' })).toThrow(
      `gmail_${header}_header_invalid`,
    );
  });
});
