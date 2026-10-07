import { strict as assert } from 'node:assert';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium, expect } from '@playwright/test';
import { checkCompletionEvidence } from './completion-cases.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const output = resolve(repo, 'test/tool-result-ui/runs');
const screenshotDir = resolve(output, 'screenshots');
await mkdir(screenshotDir, { recursive: true });
const aliases = Object.fromEntries([
  ['catalog-data', 'catalog/data.ts'], ['workflow/canvas/compile/constants', 'workflow/canvas/compile/constants.ts'],
  ['workflow/canvas/presentation/panel-fields', 'workflow/canvas/presentation/panel-fields.ts'],
  ['visual-display', 'workflow/visual-display.ts'], ['ai-catalog', 'intelligence/agent/settings/ai-catalog.ts'],
].map(([entry, path]) => ['@ax-studio/core/' + entry, resolve(repo, 'packages/core/src/' + path)]));
const server = await createServer({ configFile: false, root: repo, plugins: [react()], resolve: { alias: aliases },
  optimizeDeps: { entries: [resolve(repo, 'test/tool-result-ui/index.html')] },
  server: { host: '127.0.0.1', port: 0, hmr: false, fs: { allow: [repo] } }, logLevel: 'warn' });
const results = [];
const forbiddenFlags = [/^--no-sandbox(?:=|$)/, /^--disable-setuid-sandbox(?:=|$)/, /^--disable-web-security(?:=|$)/, /^--ignore-certificate-errors(?:=|$)/];
let browser;
const sessions = [];
try {
  await server.listen();
  const address = server.httpServer.address();
  assert(address && typeof address === 'object');
  const origin = 'http://127.0.0.1:' + address.port;
  const launch = { channel: 'msedge', headless: true, chromiumSandbox: true, args: ['--enable-automation', '--disable-background-networking'] };
  assert.equal(launch.chromiumSandbox, true);
  assert(launch.args.every(arg => forbiddenFlags.every(pattern => !pattern.test(arg))), 'No sandbox or security bypass flags');
  browser = await chromium.launch(launch);
  const commandLine = await (await browser.newBrowserCDPSession()).send('Browser.getBrowserCommandLine');
  assert(commandLine.arguments.every(arg => forbiddenFlags.every(pattern => !pattern.test(arg))), 'Actual browser command line has no bypass flags');
  await writeFile(resolve(output, 'sandbox-evidence.json'), JSON.stringify({ chromiumSandbox: true, bypassFlags: [], actualArgumentsChecked: true,
    browser: browser.version(), fixture: 'production App + in-memory synthetic IPC only; no Electron launcher' }, null, 2));
  async function open(scenario, title, viewport = { width: 1488, height: 1056 }) {
    const context = await browser.newContext({ viewport, deviceScaleFactor: 1, locale: 'ko-KR', colorScheme: 'light' });
    const forbiddenRequests = [];
    await context.route('**/*', route => {
      const url = route.request().url();
      if (url.startsWith(origin + '/') || url.startsWith('data:')) return route.continue();
      forbiddenRequests.push(url); return route.abort('blockedbyclient');
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin + '/test/tool-result-ui/index.html?scenario=' + scenario);
    await page.getByRole('button', { name: title, exact: true }).click();
    await expect(page.locator('.tool-result-pane').first()).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    const session = { context, page, errors, forbiddenRequests };
    sessions.push(session);
    return session;
  }
  async function check(name, run) {
    try { await run(); results.push({ name, status: 'passed' }); console.log('PASS ' + name); }
    catch (error) { results.push({ name, status: 'failed', error: String(error) }); console.log('FAIL ' + name + ': ' + String(error)); }
  }
  async function capture(session, name) { await session.page.screenshot({ path: resolve(screenshotDir, name + '.png'), fullPage: false }); }
  await check('Gmail production renderer / exact reference viewport', async () => {
    const session = await open('gmail', 'Gmail 검수 초안', { width: 1487, height: 1058 }); const { page } = session;
    await expect(page.getByLabel('받는 사람', { exact: true })).toHaveValue('reviewer@example.test');
    await expect(page.getByLabel('메일 본문')).toContainText('요청하신 검수');
    await expect(page.getByRole('button', { name: '발송 전 확인', exact: true })).toBeEnabled();
    await capture(session, 'gmail-draft-1487x1058');
  });
  await check('Slack production renderer / exact reference viewport', async () => {
    const session = await open('slack', 'Slack 검수 메시지', { width: 1487, height: 1058 });
    await expect(session.page.getByLabel('Slack 채널')).toHaveValue('#qa-review');
    await capture(session, 'slack-draft-1487x1058');
  });
  await check('DB read-only table, NULL and collapsed details / exact reference viewport', async () => {
    const session = await open('db', 'DB 검수 조회', { width: 1486, height: 1059 }); const { page } = session;
    await expect(page.locator('.tool-result-badge')).toHaveText('읽기 전용');
    await expect(page.getByRole('table')).toBeVisible();
    assert.equal(await page.locator('.tool-result-null').count(), 1);
    assert.equal(await page.locator('details.tool-result-details').evaluate(element => element.open), false);
    await capture(session, 'db-read-1486x1059');
    await page.getByText('조회 정보', { exact: true }).click();
    await expect(page.getByText('실행 SQL은 이 결과에 포함되지 않았습니다.', { exact: false })).toBeVisible();
  });
  await check('Literal editing, confirmation invalidation, keyboard back and single dispatch', async () => {
    const session = await open('gmail', 'Gmail 검수 초안'); const { page } = session;
    const body = '직접 쓴 {{literal}}\n**검수용 본문**';
    await page.getByLabel('메일 본문').fill(body);
    await page.getByRole('button', { name: '발송 전 확인', exact: true }).click();
    await expect(page.getByRole('button', { name: '확인하고 발송', exact: true })).toBeFocused();
    await expect(page.getByText('sender@example.test', { exact: true })).toBeVisible();
    await capture(session, 'gmail-confirmation-1488x1056');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: '발송 전 확인', exact: true })).toBeFocused();
    await expect(page.getByLabel('메일 본문')).toHaveValue(body);
    await page.getByRole('button', { name: '발송 전 확인', exact: true }).click();
    await page.getByLabel('제목', { exact: true }).fill('수정 뒤 재확인');
    assert.equal(await page.getByRole('button', { name: '확인하고 발송', exact: true }).count(), 0);
    await page.getByRole('button', { name: '발송 전 확인', exact: true }).click();
    await page.evaluate(() => window.__axToolQa.pauseSends());
    await page.getByRole('button', { name: '확인하고 발송', exact: true }).evaluate(button => { button.click(); button.click(); });
    await expect(page.getByText('전송 처리 중입니다.', { exact: false })).toBeVisible();
    const locked = await page.evaluate(() => ({ ...window.__axToolQa.metrics }));
    assert.equal(locked.confirmRequests, 1); assert.equal(locked.sends, 1);
    await page.evaluate(() => window.__axToolQa.releaseSends());
    await expect(page.getByText('서비스에서 전송 완료를 확인했습니다.', { exact: true })).toBeVisible();
    const done = await page.evaluate(() => ({ ...window.__axToolQa.metrics }));
    assert.equal(done.lastParams.body, body); assert.equal(done.lastParams.subject, '수정 뒤 재확인');
  });
  await check('Missing essentials keep initial writing possible and perform zero reviews/sends', async () => {
    const session = await open('missing', 'Gmail 검수 초안'); const { page } = session;
    await page.getByRole('button', { name: '발송 전 확인', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('받는 사람, 본문');
    await page.getByLabel('받는 사람', { exact: true }).fill('human@example.test');
    await page.getByLabel('메일 본문').fill('처음부터 직접 작성한 본문');
    const metrics = await page.evaluate(() => window.__axToolQa.metrics);
    assert.equal(metrics.reviewRequests, 0); assert.equal(metrics.sends, 0);
  });
  await check('Thread and attachment requests remain visible and blocked', async () => {
    for (const [scenario, title] of [['thread', 'Slack 검수 메시지'], ['attachment', 'Gmail 검수 초안']]) {
      const session = await open(scenario, title); const { page } = session;
      await expect(page.getByRole('alert')).toContainText('전송이 차단되었습니다');
      await expect(page.getByRole('button', { name: scenario === 'thread' ? '게시 전 확인' : '발송 전 확인', exact: true })).toBeDisabled();
      assert.equal((await page.evaluate(() => window.__axToolQa.metrics)).sends, 0);
    }
  });
  await check('Navigation preserves edits, invalidates review and ignores late async identity', async () => {
    const session = await open('history', 'Gmail 검수 초안'); const { page } = session;
    await page.getByRole('button', { name: 'Gmail 초안 1', exact: true }).click();
    await page.getByLabel('메일 본문').fill('문맥을 오가도 남아 있는 직접 작성 내용');
    await page.evaluate(() => window.__axToolQa.pauseReviews());
    await page.getByRole('button', { name: '발송 전 확인', exact: true }).click();
    await page.getByRole('button', { name: '자료 · 흐름 보기', exact: true }).click();
    await page.evaluate(() => window.__axToolQa.releaseReviews());
    await page.getByRole('button', { name: '결과 편집으로 돌아가기', exact: true }).click();
    await expect(page.getByLabel('메일 본문')).toHaveValue('문맥을 오가도 남아 있는 직접 작성 내용');
    assert.equal(await page.getByRole('button', { name: '확인하고 발송', exact: true }).count(), 0);
    await page.getByRole('button', { name: 'Slack 검수 메시지', exact: true }).click();
    await page.getByRole('button', { name: 'Gmail 검수 초안', exact: true }).click();
    await page.getByRole('button', { name: 'Gmail 초안 1', exact: true }).click();
    await expect(page.getByLabel('메일 본문')).toHaveValue('문맥을 오가도 남아 있는 직접 작성 내용');
  });
  await check('Connection changes invalidate review; older result reads cannot replace newer state', async () => {
    const session = await open('gmail', 'Gmail 검수 초안'); const { page } = session;
    await page.getByRole('button', { name: '발송 전 확인', exact: true }).click();
    await page.evaluate(() => { window.__axToolQa.pauseNextRead(); window.__axToolQa.emit(); });
    await page.evaluate(() => window.__axToolQa.connectionChanged());
    await expect(page.getByRole('button', { name: '발송 전 확인', exact: true })).toBeVisible();
    await page.evaluate(() => window.__axToolQa.releaseReads());
    assert.equal(await page.getByRole('button', { name: '확인하고 발송', exact: true }).count(), 0);
  });
  await check('Cancellation remains terminal and never sends', async () => {
    const session = await open('gmail', 'Gmail 검수 초안'); const { page } = session;
    await page.getByRole('button', { name: '요청 취소', exact: true }).click();
    await expect(page.getByText('전송 요청이 취소되었습니다.', { exact: true })).toBeVisible();
    const metrics = await page.evaluate(() => window.__axToolQa.metrics);
    assert.equal(metrics.rejects, 1); assert.equal(metrics.sends, 0);
  });
  await check('Activity approval recovery uses editable result and preserves manual values', async () => {
    const session = await open('gmail', 'Gmail 검수 초안'); const { page } = session;
    await page.getByLabel('메일 본문').fill('Activity에서도 이어서 편집');
    await page.getByRole('button', { name: /^승인/ }).click();
    await expect(page.getByLabel('메일 본문')).toHaveValue('Activity에서도 이어서 편집');
    assert.equal(await page.getByRole('button', { name: '승인', exact: true }).count(), 0);
    await capture(session, 'activity-recovery-1488x1056');
  });
  await check('Unknown outcome remains terminal through refresh failure and has no retry control', async () => {
    const session = await open('gmail', 'Gmail 검수 초안'); const { page } = session;
    await page.getByRole('button', { name: '발송 전 확인', exact: true }).click();
    await page.evaluate(() => { window.__axToolQa.setSendOutcome('unknown'); window.__axToolQa.failRefresh(); });
    await page.getByRole('button', { name: '확인하고 발송', exact: true }).click();
    await expect(page.getByText('자동으로 다시 전송하지 않습니다.', { exact: false })).toBeVisible();
    assert.equal(await page.getByText('서비스에서 전송 완료를 확인했습니다.', { exact: true }).count(), 0);
    assert.equal(await page.getByRole('button', { name: '발송 전 확인', exact: true }).count(), 0);
    await capture(session, 'unknown-outcome-1488x1056');
  });
  await check('Responsive Gmail and DB panes remain usable at narrow widths', async () => {
    for (const [scenario, title, width] of [['gmail', 'Gmail 검수 초안', 900], ['db', 'DB 검수 조회', 600]]) {
      const session = await open(scenario, title, { width, height: 1056 });
      const bounds = await session.page.locator('.tool-result-header').boundingBox();
      assert(bounds && bounds.y + bounds.height < 1056, 'Tool identity is visible in the initial viewport');
      if (scenario === 'db') {
        const sidebar = await session.page.locator('.workspace-sidebar').boundingBox();
        assert(sidebar && sidebar.width === width, 'Compact navigation uses the available mobile width');
        await expect(session.page.getByRole('table')).toBeInViewport();
        await session.page.getByRole('button', { name: '대화와 업무 목록 열기', exact: true }).click();
        await expect(session.page.getByRole('button', { name: 'DB 검수 조회', exact: true })).toBeVisible();
        await session.page.getByRole('button', { name: '대화와 업무 목록 닫기', exact: true }).click();
      } else {
        await session.page.getByRole('button', { name: '발송 전 확인', exact: true }).scrollIntoViewIfNeeded();
        await expect(session.page.getByRole('button', { name: '발송 전 확인', exact: true })).toBeInViewport();
        await session.page.locator('.work-conversation-body').evaluate(element => { element.scrollTop = 0; });
      }
      await capture(session, scenario + '-narrow-' + width + 'x1056');
      const overflow = await session.page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      assert.equal(overflow, false, 'No page-level horizontal overflow');
    }
  });
  await check('Confirmed receipt survives a failed refresh with a visible warning and no resend', async () => {
    const session = await open('gmail', 'Gmail 검수 초안'); const { page } = session;
    await page.getByRole('button', { name: '발송 전 확인', exact: true }).click();
    await page.evaluate(() => window.__axToolQa.failRefresh());
    await page.getByRole('button', { name: '확인하고 발송', exact: true }).click();
    await expect(page.getByText('서비스에서 전송 완료를 확인했습니다.', { exact: false })).toBeVisible();
    await expect(page.getByText('화면 기록을 새로 불러오지 못했습니다.', { exact: false })).toBeVisible();
    await expect(page.getByText('synthetic-receipt-only', { exact: false })).toBeVisible();
    assert.equal(await page.getByRole('button', { name: '발송 전 확인', exact: true }).count(), 0);
    assert.equal(await page.getByRole('button', { name: '확인하고 발송', exact: true }).count(), 0);
    assert.equal((await page.evaluate(() => window.__axToolQa.metrics)).sends, 1);
    await page.getByRole('button', { name: 'Slack 검수 메시지', exact: true }).click();
    assert.equal(await page.getByText('화면 기록을 새로 불러오지 못했습니다.', { exact: false }).count(), 0);
    await page.getByRole('button', { name: 'Gmail 검수 초안', exact: true }).click();
    await expect(page.getByText('화면 기록을 새로 불러오지 못했습니다.', { exact: false })).toBeVisible();
    await expect(page.getByText('synthetic-receipt-only', { exact: false })).toBeVisible();
    assert.equal(await page.getByRole('button', { name: '발송 전 확인', exact: true }).count(), 0);
    assert.equal((await page.evaluate(() => window.__axToolQa.metrics)).sends, 1);
    await capture(session, 'sent-refresh-warning-1488x1056');
  });
  await checkCompletionEvidence({ open, check, capture, expect, assert });
  await check('All browser fixtures remain isolated and have no unexpected API calls', async () => {
    for (const session of sessions) {
      assert.deepEqual(session.errors, []); assert.deepEqual(session.forbiddenRequests, []);
      assert.deepEqual(await session.page.evaluate(() => window.__axToolQa.metrics.unexpectedCalls), []);
    }
  });
} catch (error) {
  results.push({ name: 'Sandbox-enabled browser launch or fixture setup', status: 'blocked', error: String(error) });
  console.log('BLOCKED ' + String(error));
} finally {
  for (const session of sessions) await session.context.close().catch(() => undefined);
  await browser?.close().catch(() => undefined); await server.close();
  await writeFile(resolve(output, 'results.json'), JSON.stringify({ timestamp: new Date().toISOString(), viewport: { width: 1488, height: 1056 },
    referenceViewports: { gmail: { width: 1487, height: 1058 }, slack: { width: 1487, height: 1058 }, db: { width: 1486, height: 1059 } }, results }, null, 2));
}
if (results.some(result => result.status !== 'passed')) process.exitCode = 1;
