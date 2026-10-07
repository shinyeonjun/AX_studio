import { describe, expect, it } from 'vitest';
import { GMAIL_CALLBACK_PAGE_HEADERS, gmailCallbackPage } from './callback-page.js';

describe('the page Google returns the person to', () => {
  it('says what happened and what to do, in Korean, for every outcome', () => {
    expect(gmailCallbackPage('signed_in')).toContain('Google 로그인을 마쳤어요');
    expect(gmailCallbackPage('denied')).toContain('권한을 허용하지 않아');
    expect(gmailCallbackPage('failed')).toContain('다시 눌러 주세요');
    expect(gmailCallbackPage('expired')).toContain('더 이상 쓸 수 없어요');
  });

  it('loads and runs nothing from anywhere', () => {
    for (const outcome of ['signed_in', 'denied', 'failed', 'expired'] as const) {
      const html = gmailCallbackPage(outcome);
      expect(html).not.toMatch(/<script|<link|https?:\/\//iu);
    }
    expect(GMAIL_CALLBACK_PAGE_HEADERS['Content-Security-Policy']).toContain("default-src 'none'");
  });
});
