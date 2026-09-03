import { describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../../../../store/db.js';
import { WorkflowStore } from '../../../../store/workflow-store.js';
import { AxCommandService } from '../../service.js';
import { repairCommandCandidate, repairCommandWorkflow } from './fixtures.js';

const commandChatContext = { executionContext: { origin: 'agent' as const } };

describe('AxCommandService repair rejection', () => {
  it('keeps repair rejection behind the agent mutation boundary', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const workflow = repairCommandWorkflow();
    store.saveWorkflow(workflow);
    const proposal = store.createRepairProposal({
      workflowId: workflow.id!,
      baseVersion: 1,
      candidates: [repairCommandCandidate],
    });
    const service = new AxCommandService(store);
    const args = { repairId: proposal.id, baseVersion: 1, reason: '현재는 유지' };

    const hostResponse = await service.execute({ name: 'repair.reject', args });
    expect(hostResponse.status).toBe('forbidden');
    const agentResponse = await service.execute({ name: 'repair.reject', args }, commandChatContext);

    expect(agentResponse).toMatchObject({
      command: 'repair.reject',
      status: 'ok',
      data: { repairId: proposal.id, workflowId: workflow.id, status: 'rejected' },
    });
    db.close?.();
  });
});
