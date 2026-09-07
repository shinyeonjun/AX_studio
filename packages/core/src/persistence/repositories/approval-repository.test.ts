import { describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../db.js';
import { claimApproval, createApproval, getApproval } from './approval-repository.js';
import { createExecution, deleteExecution } from './execution-repository.js';

describe('approval persistence boundaries', () => {
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
});
