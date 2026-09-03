import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { createAxStudioCore } from '../bootstrap.js';
import { runSavedWorkflowById } from '../runtime/manual-workflow-run.js';
import type { WorkflowIR } from '../workflow/schema.js';

describe('saved workflow completion projection', () => {
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
});
