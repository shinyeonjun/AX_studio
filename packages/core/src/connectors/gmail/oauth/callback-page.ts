/**
 * The page the browser shows when Google sends the person back to AX Studio's loopback address.
 * Self-contained (no scripts, fonts or images from elsewhere) and honest about timing: it appears
 * right after Google sign-in, while the app is still finishing the connection, so success says the
 * sign-in is done and the app has the final word.
 */
export type GmailCallbackOutcome = 'signed_in' | 'denied' | 'failed' | 'expired';

const PAGES: Record<GmailCallbackOutcome, { tone: 'ok' | 'warn' | 'error'; title: string; body: string; hint: string }> = {
  signed_in: {
    tone: 'ok',
    title: 'Google 로그인을 마쳤어요',
    body: 'AX Studio가 Gmail 연결을 마무리하고 있어요. 앱으로 돌아가면 연결 결과를 볼 수 있어요.',
    hint: '이 탭은 닫아도 됩니다.',
  },
  denied: {
    tone: 'warn',
    title: 'Gmail 연결을 취소했어요',
    body: 'Google 화면에서 권한을 허용하지 않아 연결하지 않았어요. 다시 연결하려면 AX Studio에서 "Gmail 연결하기"를 눌러 주세요.',
    hint: '이 탭은 닫아도 됩니다.',
  },
  failed: {
    tone: 'error',
    title: 'Google 로그인에 실패했어요',
    body: 'Google에서 로그인 결과를 받지 못했어요. AX Studio에서 "Gmail 연결하기"를 다시 눌러 주세요.',
    hint: '계속 실패하면 AX Studio를 다시 시작한 뒤 연결해 주세요.',
  },
  expired: {
    tone: 'warn',
    title: '이 로그인 화면은 더 이상 쓸 수 없어요',
    body: '새 연결을 시작했거나 시간이 지나 이 로그인은 끝났어요. AX Studio에서 "Gmail 연결하기"를 다시 눌러 주세요.',
    hint: '이 탭은 닫아도 됩니다.',
  },
};

const ICONS: Record<'ok' | 'warn' | 'error', string> = {
  ok: '<path d="M7 12.5l3.2 3.2L17 9" />',
  warn: '<path d="M12 7.5v5.5" /><path d="M12 16.5h.01" />',
  error: '<path d="M8.5 8.5l7 7" /><path d="M15.5 8.5l-7 7" />',
};

export const GMAIL_CALLBACK_PAGE_HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-store',
  // Nothing on the page loads or runs; it only shows the result.
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
} as const;

export function gmailCallbackPage(outcome: GmailCallbackOutcome): string {
  const page = PAGES[outcome];
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${page.title} · AX Studio</title>
<style>
  :root {
    --bg: #eef2fb; --card: #ffffff; --text: #2a2f45; --muted: #5c6478; --border: #d4dff0;
    --ok: #1f9d6b; --ok-bg: rgba(31, 157, 107, 0.12);
    --warn: #c27c0e; --warn-bg: rgba(194, 124, 14, 0.12);
    --error: #d64545; --error-bg: rgba(214, 69, 69, 0.12);
    --brand: #7c5cd6;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #12172a; --card: #1b2236; --text: #e8ebf4; --muted: #9aa3b8; --border: #2c3548;
      --ok: #4cc79a; --ok-bg: rgba(76, 199, 154, 0.16);
      --warn: #e6a640; --warn-bg: rgba(230, 166, 64, 0.16);
      --error: #f07a7a; --error-bg: rgba(240, 122, 122, 0.16);
      --brand: #a68cf0;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px 16px;
    background: var(--bg); color: var(--text);
    font-family: "Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif;
  }
  main {
    width: min(440px, 100%); background: var(--card); border: 1px solid var(--border);
    border-radius: 18px; padding: 32px 28px 26px; text-align: center;
    box-shadow: 0 12px 40px rgba(20, 24, 45, 0.08);
  }
  .brand { font-size: 13px; font-weight: 700; letter-spacing: 0.02em; color: var(--brand); margin: 0 0 22px; }
  .icon { width: 64px; height: 64px; margin: 0 auto 18px; border-radius: 50%; display: grid; place-items: center; }
  .icon svg { width: 32px; height: 32px; fill: none; stroke: currentColor; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }
  .ok { color: var(--ok); background: var(--ok-bg); }
  .warn { color: var(--warn); background: var(--warn-bg); }
  .error { color: var(--error); background: var(--error-bg); }
  h1 { font-size: 21px; line-height: 1.4; margin: 0 0 10px; word-break: keep-all; }
  p.body { font-size: 15px; line-height: 1.65; color: var(--muted); margin: 0; word-break: keep-all; }
  p.hint { font-size: 13px; color: var(--muted); margin: 22px 0 0; padding-top: 16px; border-top: 1px solid var(--border); word-break: keep-all; }
</style>
</head>
<body>
<main role="${page.tone === 'ok' ? 'status' : 'alert'}">
  <p class="brand">AX Studio · Gmail 연결</p>
  <div class="icon ${page.tone}" aria-hidden="true"><svg viewBox="0 0 24 24">${ICONS[page.tone]}</svg></div>
  <h1>${page.title}</h1>
  <p class="body">${page.body}</p>
  <p class="hint">${page.hint}</p>
</main>
</body>
</html>`;
}
