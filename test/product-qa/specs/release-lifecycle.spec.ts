import { expect, test } from '@playwright/test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createSqlJsDatabase } from '../../../packages/core/dist/persistence/db/sqljs.js';
import { WorkflowStore } from '../../../packages/core/dist/persistence/workflow-store.js';
import { resolveAxDataPaths } from '../../../packages/core/dist/persistence/paths/ax-data.js';
import { closeDesktop, launchDesktop, tempRunId, type DesktopContext } from '../lib/desktop-app.js';

// No IPC replacement: seed durable data, then exercise real startup, storage and UI.
if (process.env.AX_PRODUCT_QA_MODE === 'deterministic' && !process.env.AX_PRODUCT_QA_PRINT) {
  test('restart recovery and activity deletion preserve the live approval across a second restart', async () => {
    const dataRoot = mkdtempSync(join(tmpdir(), 'ax-release-ui-'));
    const runId = process.env.AX_PRODUCT_QA_RUN_ID ?? tempRunId();
    let ctx: DesktopContext | undefined;
    const rendererErrors: string[] = [];
    try {
      const paths = resolveAxDataPaths({ dataRoot });
      mkdirSync(dirname(paths.database), { recursive: true });
      const db = await createSqlJsDatabase(paths.database);
      const store = new WorkflowStore(db);
      let pending: string;
      let approval: string;
      let interrupted: string;
      try {
        const chat = store.saveWorkspaceChat({ messages: [{ role: 'user', content: '재시작 전 대화' }] });
        interrupted = store.createExecution({ ephemeral: true, workspaceSessionId: chat.id });
        pending = store.createExecution({ ephemeral: true });
        store.markExecutionPending(pending);
        approval = store.createApproval({ executionId: pending, actionIds: ['send'], reason: '발송 전 사용자 확인' });
        const completed = store.createExecution({ ephemeral: true });
        store.finishExecution(completed, 'success', undefined, []);
      } finally { db.close?.(); }

      ctx = await launchDesktop({ mode: 'deterministic', dataRoot, runId, scenarioId: 'release-lifecycle' });
      ctx.page.on('pageerror', (error) => rendererErrors.push(error.message));
      const first = await ctx.page.evaluate(() => window.ax.getState());
      expect(first.executions.find((entry) => entry.id === interrupted)).toMatchObject({ status: 'failed', errorCode: 'execution_interrupted' });
      expect(first.executions.find((entry) => entry.id === pending)).toMatchObject({ status: 'pending_approval' });
      await ctx.page.locator('.workspace-sidebar-tab', { hasText: '활동' }).click();
      const pendingRow = ctx.page.locator('.timeline-item').filter({ hasText: '승인 대기' });
      await expect(pendingRow.getByRole('button', { name: '기록 삭제', exact: true })).toBeDisabled();
      await expect(ctx.page.locator('.timeline-item')).toHaveCount(3);
      await expect(ctx.page.locator('.timeline-item').filter({ hasText: '앱이 종료' })).toHaveCount(1);
      let confirmation = '';
      ctx.page.once('dialog', async (dialog) => { confirmation = dialog.message(); await dialog.accept(); });
      await ctx.page.getByRole('button', { name: '기록 모두 지우기', exact: true }).click();
      await expect(ctx.page.locator('.timeline-item')).toHaveCount(1);
      expect(confirmation).toContain('승인 대기 중인 기록은 남겨둡니다');
      await expect(pendingRow.getByRole('button', { name: '기록 삭제', exact: true })).toBeDisabled();
      await closeDesktop(ctx); ctx = undefined;

      ctx = await launchDesktop({ mode: 'deterministic', dataRoot, runId, scenarioId: 'release-lifecycle-reopen' });
      ctx.page.on('pageerror', (error) => rendererErrors.push(error.message));
      const reopened = await ctx.page.evaluate(() => window.ax.getState());
      expect(reopened.executions).toHaveLength(1);
      expect(reopened.executions[0]).toMatchObject({ id: pending, status: 'pending_approval' });
      expect(reopened.pendingApprovals).toBe(1);
      expect(reopened.approvals.map((entry) => entry.id)).toContain(approval);
      await expect(ctx.page.getByRole('button', { name: '재시작 전 대화', exact: true })).toBeVisible({ timeout: 10_000 });
      expect(rendererErrors).toEqual([]);
    } finally {
      if (ctx) await closeDesktop(ctx);
      rmSync(dataRoot, { recursive: true, force: true });
    }
  });
}
