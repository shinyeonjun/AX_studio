import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { createAxStudioCore, type AxStudioCore } from '../../application/bootstrap.js';
import { createDatabaseAsync } from '../../persistence/db.js';
import { WorkflowStore } from '../../persistence/workflow-store.js';
import { resolveAxDataPaths } from '../../persistence/paths/ax-data.js';

describe('startup execution recovery', () => {
  it('recovers interrupted runs without replaying effects and retains pending approvals and completed evidence', async () => {
    const dataRoot = mkdtempSync(join(tmpdir(), 'ax-restart-recovery-'));
    const paths = resolveAxDataPaths({ dataRoot });
    let core: AxStudioCore | undefined;
    try {
      const db = await createDatabaseAsync(paths.database);
      const store = new WorkflowStore(db);
      const { workflowId } = store.saveWorkflow({
        id: 'interrupted-schedule', name: '완료 여부 확인 필요', goal: '중복 실행 방지', version: 1,
        trigger: { type: 'schedule', schedule: '* * * * *', timezone: 'UTC' }, steps: [],
        permissions: {}, approval: [], allowExternalAuto: false, assumptions: [], sideEffects: {}, dataPolicy: {},
      });
      store.setWorkflowActive(workflowId, true);
      const chat = store.saveWorkspaceChat({ messages: [{ role: 'user', content: '기존 결과 보존' }] });
      const running = store.createExecution({ workflowId, workflowVersion: 1, ephemeral: false, workspaceSessionId: chat.id });
      const evidence = [{ at: '2026-01-01T00:00:00.000Z', level: 'info', code: 'step_completed', message: '첫 단계 완료' }];
      store.updateExecutionLog(running, evidence);
      const claimed = store.createExecution({ ephemeral: true });
      store.markExecutionPending(claimed);
      const processingApproval = store.createApproval({ executionId: claimed, actionIds: ['send'], reason: '확인 중' });
      store.claimApproval(processingApproval);
      const pending = store.createExecution({ ephemeral: true });
      store.markExecutionPending(pending);
      const pendingApproval = store.createApproval({ executionId: pending, actionIds: ['send'], reason: '사용자 확인 대기', payload: { checkpoint: { variables: { amount: 100 } } } });
      const orphan = store.createExecution({ ephemeral: true });
      store.markExecutionPending(orphan);
      const completed = store.createExecution({ ephemeral: true });
      store.finishExecution(completed, 'success', undefined, evidence);
      const completedBefore = store.getExecution(completed);
      const pendingBefore = store.getApproval(pendingApproval);
      db.close?.();

      core = await createAxStudioCore({ dataRoot, recoverInterruptedExecutions: true });
      for (const id of [running, claimed, orphan]) {
        expect(core.store.getExecution(id)).toMatchObject({ status: 'failed', errorCode: 'execution_interrupted', finishedAt: expect.any(String) });
      }
      expect(core.store.getApproval(processingApproval)?.status).toBe('failed');
      expect(core.store.getApproval(pendingApproval)).toEqual(pendingBefore);
      expect(core.store.getExecution(pending)?.status).toBe('pending_approval');
      expect(core.store.getExecution(completed)).toEqual(completedBefore);
      expect(JSON.parse(core.store.getExecution(running)!.logJson!)).toContainEqual(evidence[0]);
      expect(core.store.isWorkflowActive(workflowId)).toBe(false);
      expect(core.store.listExecutions()).toHaveLength(5);
      expect(core.store.getWorkspaceChat(chat.id)?.messages).toContainEqual(expect.objectContaining({
        kind: 'execution_result', executionId: running, executionStatus: 'failed',
      }));
      const recovered = core.store.getExecution(running);
      const messages = core.store.getWorkspaceChat(chat.id)?.messages;
      await core.agentHarness.dispose();
      core.db.close?.();
      core = undefined;

      core = await createAxStudioCore({ dataRoot, recoverInterruptedExecutions: true });
      expect(core.store.getExecution(running)).toEqual(recovered);
      expect(core.store.getWorkspaceChat(chat.id)?.messages).toEqual(messages);
      expect(core.store.getApproval(pendingApproval)).toEqual(pendingBefore);
    } finally {
      await core?.agentHarness.dispose();
      core?.db.close?.();
      rmSync(dataRoot, { recursive: true, force: true });
    }
  });
});
