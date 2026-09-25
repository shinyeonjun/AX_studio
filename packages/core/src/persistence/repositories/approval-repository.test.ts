import { describe, expect, it, vi } from 'vitest';
import { createDatabaseAsync } from '../db.js';
import {
  claimApproval,
  createApproval,
  getApproval,
  getPendingApprovalsWithExecutionSnapshots,
} from './approval-repository.js';
import {
  clearExecutions,
  createExecution,
  deleteExecution,
  finishExecution,
  getExecution,
  markExecutionPending,
} from './execution-repository.js';

describe('approval persistence boundaries', () => {
  it('loads pending approvals and execution snapshots in one query', async () => {
    const db = await createDatabaseAsync(':memory:');
    try {
      const irJson = JSON.stringify({ id: 'workflow-1', version: 1 });
      const executionId = createExecution(db, { ephemeral: true, irJson });
      const approvalId = createApproval(db, {
        executionId,
        actionIds: ['notify'],
        reason: 'snapshot batch',
      });
      const olderExecutionId = createExecution(db, { ephemeral: true, irJson: JSON.stringify({ snapshot: 'older' }) });
      const olderApprovalId = createApproval(db, {
        executionId: olderExecutionId,
        actionIds: ['archive'],
        reason: 'older approval',
      });
      db.prepare('UPDATE approvals SET created_at = ? WHERE id = ?').run('2026-09-25T10:00:00.000Z', approvalId);
      db.prepare('UPDATE approvals SET created_at = ? WHERE id = ?').run('2026-09-24T10:00:00.000Z', olderApprovalId);
      const originalPrepare = db.prepare.bind(db);
      const prepare = vi.spyOn(db, 'prepare').mockImplementation((sql) => originalPrepare(sql));

      expect(getPendingApprovalsWithExecutionSnapshots(db)).toMatchObject([
        { approval: { id: approvalId, executionId, actionIds: ['notify'] }, executionIrJson: irJson },
        { approval: { id: olderApprovalId, executionId: olderExecutionId, actionIds: ['archive'] },
          executionIrJson: JSON.stringify({ snapshot: 'older' }) },
      ]);
      expect(prepare.mock.calls.filter(([sql]) => sql.includes('FROM approvals a'))).toHaveLength(1);
    } finally {
      db.close?.();
    }
  });

  it.each([
    ['false', false],
    ['zero', 0],
    ['empty string', ''],
  ])('preserves a %s approval payload', async (_label, payload) => {
    const db = await createDatabaseAsync(':memory:');
    const executionId = createExecution(db, { ephemeral: true });
    const approvalId = createApproval(db, {
      executionId,
      actionIds: ['notify'],
      reason: 'payload round trip',
      payload,
    });

    expect(getApproval(db, approvalId)?.payload).toBe(payload);
  });

  it('reports corrupted approval JSON with its record and field', async () => {
    const db = await createDatabaseAsync(':memory:');
    const executionId = 'execution-1';
    db.prepare(
      'INSERT INTO executions (id, ephemeral, status, started_at, log_json) VALUES (?, ?, ?, ?, ?)',
    ).run(executionId, 1, 'failed', new Date().toISOString(), '[]');
    const approvalId = createApproval(db, {
      executionId,
      actionIds: ['notify'],
      reason: '테스트',
    });
    db.prepare('UPDATE approvals SET payload_json = ? WHERE id = ?').run('{broken', approvalId);

    expect(() => getApproval(db, approvalId)).toThrowError(/JSON이 손상되었습니다/);
    try {
      getApproval(db, approvalId);
    } catch (error) {
      expect(error).toMatchObject({ code: 'invalid_approval_json', approvalId, field: 'payload' });
    }
  });

  it('keeps an execution while its approval is being processed', async () => {
    const db = await createDatabaseAsync(':memory:');
    const executionId = createExecution(db, { ephemeral: true });
    const approvalId = createApproval(db, {
      executionId,
      actionIds: ['send_mail'],
      reason: '동시성 보호',
    });

    expect(claimApproval(db, approvalId)).toBe(true);
    expect(() => deleteExecution(db, executionId)).toThrow('승인 대기 중인 실행은 삭제할 수 없습니다.');
    expect(getApproval(db, approvalId)?.status).toBe('processing');
  });

  it('rejects deleting a running execution', async () => {
    const db = await createDatabaseAsync(':memory:');
    const executionId = createExecution(db, { ephemeral: true });

    expect(() => deleteExecution(db, executionId)).toThrow('실행 중인 실행은 삭제할 수 없습니다.');
    expect(getExecution(db, executionId)?.status).toBe('running');
  });

  it('clears only terminal executions and preserves active state', async () => {
    const db = await createDatabaseAsync(':memory:');
    const runningId = createExecution(db, { ephemeral: true });
    const pendingId = createExecution(db, { ephemeral: true });
    const finishedId = createExecution(db, { ephemeral: true });
    markExecutionPending(db, pendingId);
    finishExecution(db, finishedId, 'success');

    expect(clearExecutions(db)).toBe(1);
    expect(getExecution(db, runningId)?.status).toBe('running');
    expect(getExecution(db, pendingId)?.status).toBe('pending_approval');
    expect(getExecution(db, finishedId)).toBeUndefined();
  });
});
