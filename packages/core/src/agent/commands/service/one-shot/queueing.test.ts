import { describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../../../../store/db.js';
import { WorkflowStore } from '../../../../store/workflow-store.js';
import { AxCommandService } from '../../service.js';
import { commandChatContext } from '../fixtures.js';

describe('AxCommandService one-shot queue', () => {
  it('queues a validated one-shot plan without persisting a workflow', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const queued: unknown[] = [];
    const service = new AxCommandService(store, {
      enqueueOnce: (workflow) => {
        queued.push(workflow);
        return { jobId: 'job-1' };
      },
    });

    const response = await service.execute({
      name: 'execution.enqueue_once',
      args: { name: '일회 테스트', goal: '한 번 실행한다' },
    }, commandChatContext);

    expect(response).toMatchObject({
      command: 'execution.enqueue_once',
      status: 'queued',
      data: { queued: true, ephemeral: true, jobId: 'job-1' },
    });
    expect(queued).toHaveLength(1);
    expect(store.listWorkflows()).toHaveLength(0);
  });
});
