import { describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../../../../../persistence/db.js';
import { WorkflowStore } from '../../../../../persistence/workflow-store.js';
import { AxCommandService } from '../../service.js';
import { commandChatContext } from '../fixtures.js';

describe('AxCommandService one-shot queue', () => {
  it('provides an executable action shape to the agent in the command contract', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    store.setConnection('gmail', true);
    const queued: unknown[] = [];
    const service = new AxCommandService(store, {
      enqueueOnce: workflow => { queued.push(workflow); return { jobId: 'contract-example' }; },
    });
    const entry = service.listCommands(commandChatContext.executionContext)
      .find(command => command.name === 'execution.enqueue_once')!;
    const example = entry.args.steps.match(/\[\{.*\}\]/)?.[0];
    expect(example).toBeDefined();
    const response = await service.execute({ name: 'execution.enqueue_once', args: {
      name: 'Contract example', goal: 'Check input shape without sending', steps: JSON.parse(example!),
    } }, commandChatContext);
    expect(response.status).toBe('queued');
    expect(queued).toHaveLength(1);
    expect(store.listWorkflows()).toHaveLength(0);
    db.close();
  });

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
