import { describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../db.js';
import { WorkflowStore } from '../workflow-store.js';

describe('deleting a work', () => {
  it('keeps the conversation that made it, no longer pointing at it', async () => {
    const store = new WorkflowStore(await createDatabaseAsync(':memory:'));
    const { workflowId } = store.saveWorkflow({
      id: 'wf-chat', name: '주간 보고', goal: '주간 보고', version: 1, inputs: [], steps: [], permissions: {},
      approval: [], allowExternalAuto: false, assumptions: [], sideEffects: {}, dataPolicy: {},
    });
    const saved = store.saveWorkspaceChat({ messages: [{ role: 'user', content: '주간 보고 만들어줘' }], workflowId });
    expect(store.deleteWorkflow(workflowId)).toBe(true);
    const chat = store.getWorkspaceChat(saved.id);
    expect(chat?.messages).toHaveLength(1);
    expect(chat?.workflowId).toBeUndefined();
    expect(store.getWorkspaceChatByWorkflowId(workflowId)).toBeFalsy();
  });
});
