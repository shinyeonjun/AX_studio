import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppDatabase } from '../../../../persistence/db.js';
import { WorkflowStore } from '../../../../persistence/workflow-store.js';
import {
  createPreviewApprovalFixture, INVALID_PREVIEW_HISTORIES, openCurrentPreviewHistory, previewApprovalHistoryBytes,
} from '../../../../persistence/repositories/fixtures/preview-approval-history.fixture.js';
import { WorkflowRuntime } from '../../../engine.js';

describe.each(['native', 'sqljs'] as const)('preview approval failure preserves evidence (%s)', backend => {
  let directory: string;
  let db: AppDatabase;
  afterEach(() => { db?.close?.(); if (directory) rmSync(directory, { recursive: true, force: true }); });

  it.each(INVALID_PREVIEW_HISTORIES)('fails closed without replacing %s bytes', async condition => {
    directory = mkdtempSync(join(tmpdir(), 'ax-preview-approval-'));
    const filePath = join(directory, 'synthetic.db');
    const fixture = createPreviewApprovalFixture(filePath, condition);
    db = await openCurrentPreviewHistory(filePath, backend);
    const evidence = previewApprovalHistoryBytes(db);
    const store = new WorkflowStore(db);
    const execute = vi.fn(async () => ({ ok: true }));
    const finished = vi.fn();
    const runtime = new WorkflowRuntime({ store, globalActive: true,
      connectors: { synthetic: { name: 'Synthetic only', execute } }, onExecutionFinished: finished });
    expect(store.getExecution(fixture.pendingId)?.historyDiagnostics.some(d => d.source !== 'output')).toBe(true);

    const result = await runtime.continueAfterApproval(fixture.approvalId);

    expect(result).toMatchObject({ executionId: fixture.pendingId, status: 'failed', errorCode: 'invalid_execution_log' });
    expect(store.getApproval(fixture.approvalId)?.status).toBe('failed');
    expect(store.getExecution(fixture.pendingId)).toMatchObject({ status: 'failed', errorCode: 'invalid_execution_log' });
    expect(store.getExecution(fixture.pendingId)?.finishedAt).toBeTruthy();
    expect(execute).not.toHaveBeenCalled();
    expect(finished).toHaveBeenCalledExactlyOnceWith(result);
    for (let opening = 0; opening < 3; opening++) {
      expect(JSON.stringify(previewApprovalHistoryBytes(db)) === JSON.stringify(evidence), 'original checkpoint/output/tail bytes changed').toBe(true);
      const reopenedStore = new WorkflowStore(db);
      expect(reopenedStore.getApproval(fixture.approvalId)?.status).toBe('failed');
      expect(reopenedStore.getExecution(fixture.pendingId)?.historyDiagnostics.some(d => d.source !== 'output')).toBe(true);
      if (opening < 2) { db.close?.(); db = await openCurrentPreviewHistory(filePath, backend); }
    }
    const retryRuntime = new WorkflowRuntime({ store: new WorkflowStore(db), globalActive: true, connectors: {} });
    expect((await retryRuntime.continueAfterApproval(fixture.approvalId)).errorCode).toBe('approval_already_resolved');
    expect(JSON.stringify(previewApprovalHistoryBytes(db)) === JSON.stringify(evidence), 'original checkpoint/output/tail bytes changed').toBe(true);
  });

  it.each([null, '{broken'])('preserves valid history when the approval snapshot is invalid (%s)', async snapshot => {
    directory = mkdtempSync(join(tmpdir(), 'ax-preview-snapshot-'));
    const filePath = join(directory, 'synthetic.db');
    const fixture = createPreviewApprovalFixture(filePath, 'valid');
    db = await openCurrentPreviewHistory(filePath, backend);
    db.prepare('UPDATE executions SET ir_json = ? WHERE id = ?').run(snapshot, fixture.pendingId);
    const evidence = previewApprovalHistoryBytes(db);
    const store = new WorkflowStore(db);
    const runtime = new WorkflowRuntime({ store, globalActive: true, connectors: {} });
    expect((await runtime.continueAfterApproval(fixture.approvalId)).errorCode).toBe('invalid_execution_snapshot');
    expect(store.getApproval(fixture.approvalId)?.status).toBe('failed');
    expect(JSON.stringify(previewApprovalHistoryBytes(db)) === JSON.stringify(evidence), 'original checkpoint/output/tail bytes changed').toBe(true);
  });
});
