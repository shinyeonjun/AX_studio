import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { createAxStudioCore } from './bootstrap.js';
import { runSavedWorkflowById } from './runtime/manual-workflow-run.js';
import type { WorkflowIR } from './workflow/schema.js';

describe('core completion projection wiring', () => {
  it('publishes a saved manual run through the bootstrap completion boundary', async () => {
    const dataRoot = mkdtempSync(join(tmpdir(), 'ax-bootstrap-result-'));
    const events: Array<{ sessionId: string; workflowId?: string; executionId: string }> = [];
    const workflow: WorkflowIR = {
      id: 'workflow-bootstrap-result',
      name: '부트스트랩 결과',
      goal: '완료 결과를 대화에 남긴다',
      version: 1,
      steps: [],
      permissions: {},
      approval: [],
      allowExternalAuto: true,
      assumptions: [],
      sideEffects: {},
      dataPolicy: {},
    };

    let core: Awaited<ReturnType<typeof createAxStudioCore>> | undefined;
    try {
      core = await createAxStudioCore({ dataRoot, onWorkspaceChatChanged: (event) => events.push(event) });
      const chat = core.store.saveWorkspaceChat({
        workflowId: workflow.id,
        messages: [{ role: 'user', content: '업무를 실행해줘' }],
      });
      core.store.saveWorkflow(workflow);

      const result = await runSavedWorkflowById({ store: core.store, runtime: core.runtime }, workflow.id!);

      expect(result.status).toBe('success');
      expect(events).toEqual([{ sessionId: chat.id, workflowId: workflow.id, executionId: result.executionId }]);
      expect(core.store.getWorkspaceChat(chat.id)?.messages).toContainEqual(expect.objectContaining({
        kind: 'execution_result',
        executionId: result.executionId,
      }));
    } finally {
      core?.db.close?.();
      rmSync(dataRoot, { recursive: true, force: true });
    }
  });

  it('publishes a queued one-shot result through the originating chat session', async () => {
    const dataRoot = mkdtempSync(join(tmpdir(), 'ax-bootstrap-ephemeral-result-'));
    let core: Awaited<ReturnType<typeof createAxStudioCore>> | undefined;
    const events: Array<{ sessionId: string; workflowId?: string; executionId: string }> = [];
    try {
      core = await createAxStudioCore({ dataRoot, onWorkspaceChatChanged: (event) => events.push(event) });
      const chat = core.store.saveWorkspaceChat({
        messages: [{ role: 'user', content: '일회 결과를 이 대화에 남겨줘' }],
      });

      const queued = await core.commandService.execute({
        name: 'execution.enqueue_once',
        args: { name: '일회 결과', goal: '한 번 실행하고 결과를 대화에 남긴다', steps: [] },
      }, {
        executionContext: { origin: 'agent' },
        workspaceSessionId: chat.id,
      });

      expect(queued).toMatchObject({ status: 'queued', data: { queued: true, ephemeral: true } });
      await core.runtime.waitForIdle();

      const execution = core.store.listExecutions(1)[0];
      expect(execution).toMatchObject({ ephemeral: true, workspaceSessionId: chat.id, status: 'success' });
      expect(events).toEqual([{ sessionId: chat.id, executionId: execution?.id }]);
      expect(core.store.getWorkspaceChat(chat.id)?.messages).toContainEqual(expect.objectContaining({
        kind: 'execution_result',
        executionId: execution?.id,
        executionStatus: 'success',
      }));
    } finally {
      await core?.runtime.waitForIdle();
      core?.db.close?.();
      rmSync(dataRoot, { recursive: true, force: true });
    }
  });

  it('projects a pending one-shot approval into the originating chat', async () => {
    const dataRoot = mkdtempSync(join(tmpdir(), 'ax-bootstrap-inline-approval-'));
    let core: Awaited<ReturnType<typeof createAxStudioCore>> | undefined;
    try {
      core = await createAxStudioCore({ dataRoot });
      core.runtime.setConnector('slack', {
        name: 'test-slack',
        execute: async () => ({ ok: true, data: { id: 'test-message' } }),
      });
      const chat = core.store.saveWorkspaceChat({
        messages: [{ role: 'user', content: '일회 공유를 승인 카드로 확인해줘' }],
      });

      const queued = core.runtime.enqueueEphemeralWorkflow({
        name: '일회 승인 테스트',
        goal: '승인 전에는 실행하지 않는다',
        version: 1,
        inputs: [],
        steps: [{
          type: 'action',
          id: 'send',
          connector: 'slack',
          action: 'message.send',
          actionRef: 'slack.message.send',
          params: { channel: '#test', text: '승인 후에만 전송' },
          sideEffect: 'EXTERNAL',
        }],
        permissions: {},
        approval: [],
        allowExternalAuto: false,
        assumptions: [],
        sideEffects: {},
        dataPolicy: {},
      }, {
        triggerType: 'manual',
        workspaceSessionId: chat.id,
      });

      expect(queued.jobId).toBeTruthy();
      await core.runtime.waitForIdle();

      const pending = core.store.getWorkspaceChat(chat.id)?.messages.at(-1);
      expect(pending).toMatchObject({
        kind: 'execution_result',
        executionStatus: 'pending_approval',
        approval: {
          title: '일회 승인 테스트 — Slack 메시지 (#test)',
          reason: '외부 작업 승인 필요: slack.message.send',
        },
      });
      expect(core.store.getPendingApprovals()).toHaveLength(1);
    } finally {
      await core?.runtime.waitForIdle();
      core?.db.close?.();
      rmSync(dataRoot, { recursive: true, force: true });
    }
  });
});
