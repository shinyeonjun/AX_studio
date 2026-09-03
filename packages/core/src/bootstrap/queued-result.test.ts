import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { createAxStudioCore } from '../bootstrap.js';

describe('queued one-shot completion projection', () => {
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
});
