// Mounted production components: SSR cannot run the asynchronous host-read effect.
export async function checkCompletionEvidence({ open, check, capture, expect, assert }) {
  await check('Retained editor displays its returned receipt when chat publication and refresh fail', async () => {
    const session = await open('gmail', 'Gmail 검수 초안'); const { page } = session;
    await page.getByLabel('메일 본문').fill('직접 작성한 유지된 완료 본문');
    await page.getByRole('button', { name: '발송 전 확인', exact: true }).click();
    await page.evaluate(() => { window.__axToolQa.keepOriginalEditor(); window.__axToolQa.failRefresh(); });
    await page.getByRole('button', { name: '확인하고 발송', exact: true }).click();
    await expect(page.getByLabel('메일 본문')).toHaveValue('직접 작성한 유지된 완료 본문');
    await expect(page.getByLabel('메일 본문')).toBeDisabled();
    await expect(page.getByText('synthetic-receipt-only', { exact: false })).toBeVisible();
    await expect(page.getByText('화면 기록을 새로 불러오지 못했습니다.', { exact: false })).toBeVisible();
    assert.equal(await page.getByRole('button', { name: '발송 전 확인', exact: true }).count(), 0);
    assert.equal(await page.getByRole('button', { name: '확인하고 발송', exact: true }).count(), 0);
    assert.equal((await page.evaluate(() => window.__axToolQa.metrics)).sends, 1);
    await capture(session, 'retained-editor-receipt-1488x1056');
  });
  await check('Cache-empty completed component recovers host-recorded warning without sending', async () => {
    const session = await open('completed-warning', 'Gmail 검수 초안'); const { page } = session;
    await expect(page.getByText('persisted-gmail-receipt', { exact: false })).toBeVisible();
    await expect(page.getByText('화면 기록을 새로 불러오지 못했습니다.', { exact: false })).toBeVisible();
    const before = await page.evaluate(() => window.__axToolQa.metrics);
    assert(before.completedReads > 0); assert.equal(before.sends, 0);
    assert.equal(before.reviewRequests, 0); assert.equal(before.confirmRequests, 0);
    assert.equal(await page.getByRole('button', { name: '발송 전 확인', exact: true }).count(), 0);
    await capture(session, 'cache-empty-host-warning-1488x1056');
    await page.reload();
    await page.getByRole('button', { name: 'Gmail 검수 초안', exact: true }).click();
    await expect(page.getByText('persisted-gmail-receipt', { exact: false })).toBeVisible();
    await expect(page.getByText('화면 기록을 새로 불러오지 못했습니다.', { exact: false })).toBeVisible();
    assert.equal((await page.evaluate(() => window.__axToolQa.metrics)).sends, 0);
  });
  await check('Late completed-warning reads stay with their execution after tool navigation', async () => {
    const session = await open('completed-warning', 'Gmail 검수 초안'); const { page } = session;
    await expect(page.getByText('화면 기록을 새로 불러오지 못했습니다.', { exact: false })).toBeVisible();
    await page.evaluate(() => { window.__axToolQa.pauseNextRead(); window.__axToolQa.emit(); });
    await page.getByRole('button', { name: 'Slack 검수 메시지', exact: true }).click();
    await expect(page.getByText('persisted-slack-receipt', { exact: false })).toBeVisible();
    await page.evaluate(() => window.__axToolQa.releaseReads());
    assert.equal(await page.getByText('화면 기록을 새로 불러오지 못했습니다.', { exact: false }).count(), 0);
    await page.getByRole('button', { name: 'Gmail 검수 초안', exact: true }).click();
    await expect(page.getByText('화면 기록을 새로 불러오지 못했습니다.', { exact: false })).toBeVisible();
    assert.equal((await page.evaluate(() => window.__axToolQa.metrics)).sends, 0);
  });
}
