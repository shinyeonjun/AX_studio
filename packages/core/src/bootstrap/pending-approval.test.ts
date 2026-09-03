import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { createAxStudioCore } from '../bootstrap.js';

describe('pending one-shot approval projection', () => {
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
