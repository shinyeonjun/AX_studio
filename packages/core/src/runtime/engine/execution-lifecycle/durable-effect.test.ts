import { mkdirSync, mkdtempSync, rmdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import { createSqlJsDatabase, openReadonlySqlJs } from '../../../persistence/db/sqljs.js';
import { WorkflowStore } from '../../../persistence/workflow-store.js';
import { WorkflowRuntime } from '../../engine.js';

describe('durable external execution boundary', () => {
  it.each([true, false])('does not send when the durable write fails with allowExternalAuto=%s', async (allowExternalAuto) => {
    const directory = mkdtempSync(join(tmpdir(), 'ax-effect-write-failure-'));
    const path = join(directory, 'state.db');
    const db = await createSqlJsDatabase(path);
    const store = new WorkflowStore(db);
    const send = vi.fn(async () => ({ ok: true }));
    const runtime = new WorkflowRuntime({ store, globalActive: true, workflowActive: {}, connectors: {
      slack: { name: 'controlled-slack', execute: send },
    } });
    // A directory at the atomic-write destination causes a real, portable I/O failure.
    mkdirSync(`${path}.tmp`);
    try {
      let result = await runtime.executeWorkflow({
        name: '저장 실패 시 전송 금지', goal: '안전하게 실패', version: 1,
        steps: [{ type: 'action', id: 'send', connector: 'slack', action: 'message.send',
          params: { channel: '#test', text: 'must not send' }, sideEffect: 'EXTERNAL' }],
        permissions: {}, approval: [], allowExternalAuto, assumptions: [], sideEffects: {}, dataPolicy: {},
      }, { ephemeral: true });
      if (!allowExternalAuto) {
        expect(result.status).toBe('pending_approval');
        result = await runtime.continueAfterApproval(result.pendingApprovalId!);
      }
      expect(result.status).toBe('failed');
      expect(send).not.toHaveBeenCalled();
    } finally {
      rmdirSync(`${path}.tmp`);
      db.close?.();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it.each([true, false])('persists intent before sending with allowExternalAuto=%s', async (allowExternalAuto) => {
    const directory = mkdtempSync(join(tmpdir(), 'ax-durable-effect-'));
    const path = join(directory, 'state.db');
    const initial = await createSqlJsDatabase(path);
    initial.close?.();
    const db = await createSqlJsDatabase(path);
    const store = new WorkflowStore(db);
    let persisted: Record<string, unknown> | undefined;
    let persistedApproval: Record<string, unknown> | undefined;
    const send = vi.fn(async (_action, _params, ctx) => {
      const disk = await openReadonlySqlJs(path);
      try {
        persisted = disk.all('SELECT * FROM executions WHERE id = ?', [ctx.executionId])[0];
        persistedApproval = disk.all('SELECT status FROM approvals WHERE execution_id = ?', [ctx.executionId])[0];
      } finally { disk.close(); }
      return { ok: true, data: { messageId: 'sent' } };
    });
    const runtime = new WorkflowRuntime({ store, globalActive: true, workflowActive: {}, connectors: {
      slack: { name: 'controlled-slack', execute: send },
    } });
    try {
      const first = await runtime.executeWorkflow({
        name: '발송 전 저장', goal: '종료 후 중복 발송 방지', version: 1,
        steps: [{ type: 'action', id: 'send', connector: 'slack', action: 'message.send',
          params: { channel: '#test', text: 'once' }, sideEffect: 'EXTERNAL' }],
        permissions: {}, approval: [], allowExternalAuto, assumptions: [], sideEffects: {}, dataPolicy: {},
      }, { ephemeral: true });
      if (!allowExternalAuto) {
        expect(first.status).toBe('pending_approval');
        expect(send).not.toHaveBeenCalled();
        expect((await runtime.continueAfterApproval(first.pendingApprovalId!)).status).toBe('success');
      } else expect(first.status).toBe('success');
      expect(send).toHaveBeenCalledTimes(1);
      expect(persisted).toBeDefined();
      expect(JSON.parse(String(persisted!.log_json))).toContainEqual(expect.objectContaining({
        code: 'external_effect_started', data: { stepId: 'send', actionRef: 'slack.message.send' },
      }));
      if (!allowExternalAuto) expect(persistedApproval?.status).toBe('processing');
    } finally { db.close?.(); rmSync(directory, { recursive: true, force: true }); }
  });
});
