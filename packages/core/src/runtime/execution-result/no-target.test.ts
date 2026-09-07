import { describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../../persistence/db.js';
import { WorkflowStore } from '../../persistence/workflow-store.js';
import { publishExecutionResultToWorkspaceChat } from '../execution-result-message.js';
import { createExecution, result } from './fixtures.js';

describe('workflow execution conversation result target handling', () => {
  it('does not create a phantom chat when the workflow has no mapped session', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const executionId = createExecution(store);

    expect(publishExecutionResultToWorkspaceChat(store, result(executionId, 'failed', []))).toBeNull();
    expect(store.listWorkspaceChats()).toHaveLength(0);
  });
});
