import { expect, test } from '@playwright/test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { closeDesktop, launchDesktop, tempRunId } from '../lib/desktop-app.js';
import { runScenario } from '../lib/step-runner.js';
import { buildReport } from '../lib/metrics.js';
import { writeReport } from '../lib/reporter.js';

test('approval QA waits for asynchronous dismissal before checking the result', async () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'ax-approval-qa-'));
  const ctx = await launchDesktop({ mode: 'deterministic', dataRoot, runId: tempRunId(), scenarioId: 'approval-qa' });
  try {
    // Exercise the real scenario runner with a deliberately asynchronous UI response.
    // This fixture tests the QA timing contract, not the product's approval backend.
    await ctx.page.setContent('<div class="ax-workspace-inline-approval"><button>취소</button></div>');
    await ctx.page.evaluate(() => {
      document.querySelector('button')!.addEventListener('click', () => {
        setTimeout(() => document.querySelector('.ax-workspace-inline-approval')!.remove(), 300);
      });
    });
    const { result } = await runScenario(ctx, {
      id: 'delayed-approval-dismissal', name: 'Asynchronous dismissal', mode: 'deterministic',
      steps: [{ action: 'clickInlineApproval', decision: 'reject' }, { check: 'inlineApprovalAbsent' }],
    }, 0, true);
    expect(result.error).toBeUndefined();
    expect(result.passed).toBe(true);
  } finally {
    await closeDesktop(ctx);
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test('QA report retains a failed worker result when the next worker reports success', async () => {
  const artifactDir = mkdtempSync(join(tmpdir(), 'ax-qa-report-'));
  const report = (id: string, passed: boolean) => buildReport({
    runId: 'worker-restart', mode: 'deterministic', strict: true,
    startedAt: '2026-01-01T00:00:00.000Z', finishedAt: '2026-01-01T00:00:01.000Z',
    dataRoot: artifactDir, replyLatenciesMs: [passed ? 300 : 100],
    scenarios: [{ scenarioId: id, scenarioName: id, mode: 'deterministic', runIndex: 0,
      startedAt: '2026-01-01T00:00:00.000Z', finishedAt: '2026-01-01T00:00:01.000Z',
      durationMs: 1000, steps: [], defects: [], passed, ...(passed ? {} : { error: 'fixture failure' }) }],
  });
  try {
    writeReport(report('failed-scenario', false), artifactDir, 'worker-1');
    writeReport(report('passed-scenario', true), artifactDir, 'worker-2');
    // The same worker refreshes its cumulative snapshot; do not double-count it.
    writeReport(report('passed-scenario', true), artifactDir, 'worker-2');
    const saved = JSON.parse(readFileSync(join(artifactDir, 'report.json'), 'utf8'));
    expect(saved.summary).toMatchObject({ scenarioRuns: 2, passed: 1, failed: 1, medianReplyMs: 100, p95ReplyMs: 300 });
    expect(saved.scenarios.find((entry: { scenarioId: string }) => entry.scenarioId === 'failed-scenario').error).toBe('fixture failure');
    expect(readFileSync(join(artifactDir, 'report.md'), 'utf8')).toContain('fixture failure');
  } finally {
    rmSync(artifactDir, { recursive: true, force: true });
  }
});

test('approval QA still fails when a clicked approval never disappears', async () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'ax-stuck-approval-qa-'));
  const ctx = await launchDesktop({ mode: 'deterministic', dataRoot, runId: tempRunId(), scenarioId: 'stuck-approval-qa' });
  try {
    await ctx.page.setContent('<div class="ax-workspace-inline-approval"><button>취소</button></div>');
    const { result } = await runScenario(ctx, {
      id: 'stuck-approval-dismissal', name: 'Stuck dismissal', mode: 'deterministic',
      steps: [{ action: 'clickInlineApproval', decision: 'reject' }, { check: 'inlineApprovalAbsent' }],
    }, 0, true);
    expect(result.passed).toBe(false);
    expect(result.error).toContain('Timeout');
    await expect(ctx.page.locator('.ax-workspace-inline-approval')).toBeVisible();
  } finally {
    await closeDesktop(ctx);
    rmSync(dataRoot, { recursive: true, force: true });
  }
});
