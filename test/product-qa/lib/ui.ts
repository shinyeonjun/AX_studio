import type { Page } from '@playwright/test';

export async function clickNewChat(page: Page): Promise<void> {
  await page.getByRole('button', { name: '새 대화' }).click();
}

export async function sendMessage(page: Page, text: string): Promise<void> {
  const composer = page.getByRole('textbox', { name: '메시지 입력' });
  await composer.fill(text);
  await page.getByRole('button', { name: '메시지 보내기' }).click();
}

export async function isComposerDisabled(page: Page): Promise<boolean> {
  return page.getByRole('textbox', { name: '메시지 입력' }).isDisabled();
}

export async function waitForComposerReady(page: Page, timeoutMs: number): Promise<void> {
  const composer = page.getByRole('textbox', { name: '메시지 입력' });
  await composer.waitFor({ state: 'visible', timeout: timeoutMs });
  await page.waitForFunction(
    () => {
      const el = document.querySelector('textarea[aria-label="메시지 입력"]') as HTMLTextAreaElement | null;
      return el && !el.disabled;
    },
    undefined,
    { timeout: timeoutMs },
  );
}

export async function waitForComposerBusy(page: Page, timeoutMs: number): Promise<void> {
  await page.waitForFunction(
    () => {
      const el = document.querySelector('textarea[aria-label="메시지 입력"]') as HTMLTextAreaElement | null;
      return el?.disabled === true;
    },
    undefined,
    { timeout: timeoutMs },
  );
}

export async function listSessionTitles(page: Page): Promise<string[]> {
  return page.locator('.sidebar-session-title').allTextContents();
}

export async function switchSessionByTitle(page: Page, titleContains: string): Promise<void> {
  const item = page.locator('.sidebar-session-item').filter({ hasText: titleContains }).first();
  await item.click();
}

export async function readVisibleMessages(page: Page): Promise<Array<{ role: 'user' | 'assistant'; text: string }>> {
  const userTexts = await page.locator('.ax-workspace-bubble--user').allTextContents();
  const assistantTexts = await page.locator('.ax-workspace-bubble--assistant').allTextContents();
  const merged: Array<{ role: 'user' | 'assistant'; text: string }> = [];
  const count = await page.locator('.ax-workspace-message').count();
  for (let i = 0; i < count; i += 1) {
    const node = page.locator('.ax-workspace-message').nth(i);
    const className = (await node.getAttribute('class')) ?? '';
    const text = (await node.innerText()).trim();
    if (!text) continue;
    if (className.includes('ax-workspace-message--user')) merged.push({ role: 'user', text });
    if (className.includes('ax-workspace-message--assistant')) merged.push({ role: 'assistant', text });
  }
  return merged;
}

export async function attachFixtureViaE2e(page: Page, fixturePath: string, sessionId?: string): Promise<void> {
  await page.evaluate(
    async ({ path, sessionId: sid }) => {
      const ax = (window as unknown as { ax?: { e2eAttachWorkspaceSource?: (s: string | null, p: string) => Promise<unknown> } }).ax;
      if (!ax?.e2eAttachWorkspaceSource) {
        throw new Error('e2eAttachWorkspaceSource unavailable (AX_E2E=1 required)');
      }
      await ax.e2eAttachWorkspaceSource(sid ?? null, path);
    },
    { path: fixturePath, sessionId },
  );
}

export async function openSidebarTab(
  page: Page,
  tab: 'work' | 'approval' | 'activity' | 'settings',
): Promise<void> {
  const names = { work: '업무', approval: '승인', activity: '활동', settings: '설정' };
  await page.locator('.workspace-sidebar-tab', { hasText: names[tab] }).click();
}

export async function openSettingsLink(page: Page, label: string): Promise<void> {
  await page.locator('.sidebar-settings-link', { hasText: label }).first().click();
}

export async function openAiSettings(page: Page, brand: 'Claude' | 'GPT'): Promise<void> {
  await page.getByRole('button', { name: `${brand} 설정`, exact: true }).click();
}

export async function toggleTheme(page: Page): Promise<void> {
  await page.getByRole('checkbox', { name: /모드로 전환/ }).click();
}

export async function openContextTab(page: Page, tab: '자료' | '흐름'): Promise<void> {
  await page.getByRole('tab', { name: new RegExp(tab) }).click();
}

export async function deleteSessionByTitle(page: Page, titleContains: string): Promise<void> {
  page.once('dialog', (dialog) => {
    void dialog.accept();
  });
  const row = page.locator('.sidebar-session-row').filter({ hasText: titleContains }).first();
  await row.getByRole('button', { name: /대화 삭제/ }).click();
}

export async function pageTitleText(page: Page): Promise<string> {
  return (await page.locator('h1.page-title').first().textContent())?.trim() ?? '';
}

export async function errorBannerText(page: Page): Promise<string> {
  const banner = page.locator('.state-banner--error');
  if ((await banner.count()) === 0) return '';
  return ((await banner.first().innerText()) ?? '').trim();
}

export async function isAppAlive(page: Page): Promise<boolean> {
  return page.getByRole('button', { name: '새 대화' }).isVisible();
}
