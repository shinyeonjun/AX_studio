import { describe, expect, it } from 'vitest';
import { buildTableArtifact } from '../../../../contracts/artifacts/table-build.js';
import { createDatabaseAsync } from '../../../../persistence/db.js';
import { WorkflowStore } from '../../../../persistence/workflow-store.js';
import { WorkflowRuntime } from '../../../engine.js';
import type { WorkflowIR } from '../../../../workflow/schema.js';
import { createTestConnectors, mockSlack } from '../../../../testing/connectors/test-connectors.js';

/** A send whose text is made by a step that runs only after the approval. */
function ir(): WorkflowIR {
  return {
    name: '재고 알림', goal: '재고 표를 정리해 Slack으로 보낸다', version: 1, inputs: [],
    steps: [
      // Explicit approval gates take effect inside a branch.
      { type: 'if', id: 'gate', condition: { op: 'eq', left: { ref: 'enter' }, right: { lit: true } }, thenStepIds: ['approve', 'compose', 'notify'], elseStepIds: [] },
      { type: 'human_approval', id: 'approve', reason: 'Slack 발송 확인', forActionIds: ['notify'] },
      {
        type: 'action', id: 'compose', connector: 'transform', action: 'table_to_text', sideEffect: 'NONE',
        params: { table: buildTableArtifact({ id: 't', headers: ['상품', '재고'], matrix: [['사과', 3]] }) },
      },
      {
        type: 'action', id: 'notify', connector: 'slack', action: 'message.send', sideEffect: 'EXTERNAL',
        params: { channel: '#ops' }, bindings: { text: { from: 'compose', output: 'text' } },
      },
    ],
    permissions: {}, approval: [], allowExternalAuto: true, assumptions: [], sideEffects: {}, dataPolicy: {},
  } as WorkflowIR;
}

describe('content made after an approval', () => {
  it('is confirmed again with its real content before anything is sent', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const runtime = new WorkflowRuntime({ store, globalActive: true, workflowActive: {}, connectors: createTestConnectors() });
    const slack = mockSlack(runtime.connectors);

    const first = await runtime.executeWorkflow(ir(), { ephemeral: true, input: { enter: true } });
    expect(first.status, JSON.stringify(first.log.map((entry) => [entry.code, entry.message]))).toBe('pending_approval');

    // The person approved a send whose text did not exist yet; nothing may go out on that approval.
    const afterFirstApproval = await runtime.continueAfterApproval(first.pendingApprovalId!);
    expect(afterFirstApproval.status).toBe('pending_approval');
    expect(slack.messages).toHaveLength(0);
    const second = store.getApproval(afterFirstApproval.pendingApprovalId!);
    expect(second?.actionIds).toEqual(['notify']);
    expect(JSON.stringify(second?.payload)).toContain('사과');

    // Approving the real content sends exactly that content, once.
    const done = await runtime.continueAfterApproval(afterFirstApproval.pendingApprovalId!);
    expect(done.status).toBe('success');
    expect(slack.messages).toHaveLength(1);
    expect(JSON.stringify(slack.messages[0])).toContain('사과');
    db.close?.();
  });
});
