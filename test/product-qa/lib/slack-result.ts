import { expect, type Page } from '@playwright/test';
import { createRequire } from 'node:module';
import { isAbsolute, join, relative, resolve } from 'node:path';
import type { DesktopContext } from './desktop-app.js';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');

export function slackResultEditor(page: Page) {
  return page.getByRole('region', { name: 'Slack 결과 편집', exact: true });
}

export async function editSlackDraft(page: Page, draft: { channel?: string; text?: string }) {
  const pane = slackResultEditor(page);
  if (draft.channel !== undefined) await pane.getByRole('textbox', { name: 'Slack 채널', exact: true }).fill(draft.channel);
  if (draft.text !== undefined) await pane.getByRole('textbox', { name: 'Slack 메시지', exact: true }).fill(draft.text);
}

export async function clickSlackResult(page: Page, control: 'review' | 'back' | 'confirm' | 'cancel', repeat = false) {
  const label = { review: '게시 전 확인', back: '편집으로 돌아가기', confirm: '확인하고 게시', cancel: '요청 취소' }[control];
  const button = slackResultEditor(page).getByRole('button', { name: label, exact: true });
  // Two real pointer clicks exercise disabled controls and the synchronous
  // controller guard. Never invoke the IPC confirmation directly from this test.
  if (repeat) await button.dblclick({ delay: 30 });
  else await button.click();
  if (control === 'back') await expect(slackResultEditor(page).getByRole('button', { name: '게시 전 확인', exact: true })).toBeFocused();
}

export async function assertSlackDraft(page: Page, expected: { channel: string; text: string; reviewed?: boolean }) {
  const pane = slackResultEditor(page);
  await expect(pane).toBeVisible();
  await expect(pane.getByRole('textbox', { name: 'Slack 채널', exact: true })).toHaveValue(expected.channel);
  await expect(pane.getByRole('textbox', { name: 'Slack 메시지', exact: true })).toHaveValue(expected.text);
  await expect(pane).toContainText('미전송 초안');
  const confirm = pane.getByRole('button', { name: '확인하고 게시', exact: true });
  if (expected.reviewed) await expect(confirm).toBeEnabled();
  else {
    await expect(confirm).toHaveCount(0);
    await expect(pane.getByRole('button', { name: '게시 전 확인', exact: true })).toBeEnabled();
    await expect(pane.locator('.tool-result-review')).toHaveCount(0);
  }
}

export async function assertSlackReview(page: Page, expected: { channelId: string; channelLabel: string; text: string }) {
  await assertSlackDraft(page, { channel: expected.channelId, text: expected.text, reviewed: true });
  const pane = slackResultEditor(page);
  await expect(pane.locator('.tool-result-destination')).toContainText('E2E synthetic workspace · E2E synthetic bot');
  await expect(pane.locator('.tool-result-review')).toContainText('이 내용으로 Slack에 게시할까요?');
  await expect(pane.locator('.tool-result-review')).toContainText(`E2E synthetic bot → ${expected.channelLabel} (${expected.channelId})`);
  await expect(pane.locator('.tool-result-review')).toContainText('아직 전송되지 않았습니다.');
  await expect(pane.getByRole('button', { name: '확인하고 게시', exact: true })).toBeFocused();
}

export async function assertSlackTerminal(page: Page, decision: 'sent' | 'cancelled') {
  if (decision === 'sent') {
    const pane = page.getByRole('region', { name: '전송 결과', exact: true });
    await expect(pane).toBeVisible();
    await expect(pane).toContainText('서비스에서 전송 완료를 확인했습니다.');
    await expect(pane).toContainText('서비스 확인 번호: 100.001');
  } else {
    await expect(page.locator('.ax-workspace-run-card')).toContainText('실행 취소');
    await expect(page.locator('.ax-workspace-run-card')).toContainText('취소되었습니다.');
  }
  await expect(page.getByRole('button', { name: '확인하고 게시', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '게시 전 확인', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '요청 취소', exact: true })).toHaveCount(0);
}

interface FixtureExecution { id: string; status: string; error_code: string | null; log_json: string; ir_json: string }
interface FixtureAudit { code?: string; data?: { action: string; params: Record<string, unknown>; literalMessage: boolean;
  executionId: string; workspaceSessionId: string } }

/** Read-only evidence from the fresh internal fixture DB, including native SQLite WAL. */
export function readSyntheticSlackEvidence(ctx: DesktopContext, legacy = false) {
  const scope = relative(resolve(ctx.artifactDir, 'data'), resolve(ctx.dataRoot));
  if (ctx.mode !== 'deterministic' || process.env.AX_PRODUCT_QA_ISOLATED !== '1'
    || !scope || scope.startsWith('..') || isAbsolute(scope)) throw new Error('Synthetic evidence requires an isolated fixture profile');
  const db = new DatabaseSync(join(ctx.dataRoot, 'data', 'ax-studio.db'), { readOnly: true });
  try {
    const rows = (db.prepare('SELECT id, status, error_code, log_json, ir_json FROM executions WHERE ephemeral = 1').all() as unknown as FixtureExecution[])
      .filter(row => JSON.parse(row.ir_json).name === (legacy ? 'E2E legacy approval' : 'E2E 일회 승인'));
    const approvals = db.prepare('SELECT execution_id, status FROM approvals').all();
    return rows.map(row => ({ executionId: row.id, status: row.status, errorCode: row.error_code,
      approvals: approvals.filter(approval => approval.execution_id === row.id).map(approval => approval.status),
      sends: (JSON.parse(row.log_json) as FixtureAudit[]).filter(entry => entry.code === 'e2e_slack_send').map(entry => entry.data) }));
  } finally { db.close(); }
}

export async function assertSyntheticSlackEvidence(ctx: DesktopContext, expected: {
  sends: number; status: 'pending_approval' | 'success' | 'cancelled'; legacy?: boolean;
  params?: { channel: string; text: string }; literal?: boolean;
}) {
  await expect.poll(() => readSyntheticSlackEvidence(ctx, expected.legacy).map(row => ({ status: row.status, sends: row.sends.length })))
    .toEqual([{ status: expected.status, sends: expected.sends }]);
  const evidence = readSyntheticSlackEvidence(ctx, expected.legacy);
  const row = evidence[0]!;
  expect(row.approvals).toEqual([expected.status === 'pending_approval' ? 'pending' : expected.status === 'success' ? 'approved' : 'rejected']);
  if (expected.status === 'cancelled') expect(row.errorCode).toBe('approval_rejected');
  if (expected.sends > 0) {
    expect(expected.params, 'A positive send check requires the complete expected payload').toBeDefined();
    expect(row.sends).toHaveLength(expected.sends);
    for (const send of row.sends) {
      expect(send).toMatchObject({ action: 'message.send', executionId: row.executionId, literalMessage: expected.literal ?? true });
      expect(send?.params).toEqual(expected.params);
      expect(send?.workspaceSessionId).toEqual(expect.any(String));
    }
  }
  return evidence;
}
