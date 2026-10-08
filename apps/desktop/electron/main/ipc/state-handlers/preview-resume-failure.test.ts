import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AxCore } from '../../core-instance.js';
import type { AppDatabase } from '../../../../../../packages/core/src/persistence/db.js';
import { WorkflowStore } from '../../../../../../packages/core/src/persistence/workflow-store.js';
import { WorkflowRuntime } from '../../../../../../packages/core/src/runtime/engine.js';
import { appendExecutionLog } from '../../../../../../packages/core/src/persistence/repositories/fixtures/preview-0ba5e22/writer.fixture.js';
import {
  createPreviewApprovalFixture, openCurrentPreviewHistory, previewApprovalHistoryBytes,
} from '../../../../../../packages/core/src/persistence/repositories/fixtures/preview-approval-history.fixture.js';
import { buildExecutions } from './execution-state.js';

const cases = [
  { kind: 'missing snapshot', snapshot: null, errorCode: 'invalid_execution_snapshot', message: '실행 스냅샷 검증에 실패하여 실행을 재개하지 못했습니다.' },
  { kind: 'broken snapshot', snapshot: '{broken', errorCode: 'invalid_execution_snapshot', message: '실행 스냅샷 검증에 실패하여 실행을 재개하지 못했습니다.' },
  { kind: 'broken tail', snapshot: undefined, errorCode: 'invalid_execution_log', message: '실행 로그 검증에 실패하여 실행을 재개하지 못했습니다.' },
];

// Real-file DB integration (fsync on every write): well under 1 s locally, but Windows CI disks
// have exceeded the 5 s default, so allow more time without hiding a hang.
describe.each(['native', 'sqljs'] as const)('preserved resume failure state (%s)', { timeout: 30_000 }, backend => {
  let directory: string;
  let db: AppDatabase;
  afterEach(() => { db?.close?.(); if (directory) rmSync(directory, { recursive: true, force: true }); });

  describe.each([false, true])('historical error present: %s', olderError => {
    it.each(cases)('shows the terminal reason for $kind across reopens without rewriting history', async scenario => {
      directory = mkdtempSync(join(tmpdir(), 'ax-preview-state-'));
      const path = join(directory, 'synthetic.db');
      const fixture = createPreviewApprovalFixture(path, 'valid');
      db = await openCurrentPreviewHistory(path, backend);
      const checkpoint = olderError ? [...fixture.checkpoint, { ...fixture.tail, level: 'error', code: 'old_failure', message: 'An older synthetic error' }] : fixture.checkpoint;
      db.prepare('UPDATE executions SET log_json = ? WHERE id = ?').run(JSON.stringify(checkpoint), fixture.pendingId);
      appendExecutionLog(db, fixture.pendingId, fixture.waiting);
      if (scenario.snapshot !== undefined) db.prepare('UPDATE executions SET ir_json = ? WHERE id = ?').run(scenario.snapshot, fixture.pendingId);
      else db.prepare('UPDATE execution_log_entries SET entry_json = ? WHERE execution_id = ?').run('{broken', fixture.pendingId);
      const evidence = previewApprovalHistoryBytes(db);
      const execute = vi.fn(async () => ({ ok: true }));
      const store = new WorkflowStore(db);
      const runtime = new WorkflowRuntime({ store, globalActive: true,
        connectors: { synthetic: { name: 'Synthetic only', execute } } });
      const result = await runtime.continueAfterApproval(fixture.approvalId);
      expect(result).toMatchObject({ status: 'failed', errorCode: scenario.errorCode });
      expect(execute).not.toHaveBeenCalled();
      for (let opening = 0; opening < 3; opening++) {
        const reopenedStore = new WorkflowStore(db);
        const state = buildExecutions({ store: reopenedStore } as unknown as AxCore).find(e => e.id === fixture.pendingId)!;
        expect(state).toMatchObject({ status: 'failed', errorCode: scenario.errorCode, errorMessage: scenario.message });
        expect(state.finishedAt).toBeTruthy();
        expect(reopenedStore.getApproval(fixture.approvalId)?.status).toBe('failed');
        expect(JSON.stringify(previewApprovalHistoryBytes(db)) === JSON.stringify(evidence), 'original history/IR/output/tail bytes changed').toBe(true);
        if (scenario.snapshot !== undefined) {
          const log = JSON.parse(reopenedStore.getExecution(fixture.pendingId)!.logJson);
          expect(log).toEqual([...checkpoint, fixture.waiting]);
        }
        if (opening < 2) { db.close?.(); db = await openCurrentPreviewHistory(path, backend); }
      }
    });
  });
});
