import { describe, expect, it, vi } from 'vitest';
import { createDatabaseAsync } from '../../../../../persistence/db.js';
import { WorkflowStore } from '../../../../../persistence/workflow-store.js';
import { inputRequestsForResult } from '../../input-requests.js';
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

  it('keeps repeated required fields scoped to their workflow steps before queueing', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    store.setConnection('gmail', true);
    const enqueueOnce = vi.fn(() => ({ jobId: 'must-not-queue' }));
    const service = new AxCommandService(store, { enqueueOnce });

    const result = await service.execute({
      name: 'execution.enqueue_once',
      args: {
        name: '두 메일 보내기',
        goal: '두 명에게 같은 메일을 보낸다',
        steps: [1, 2].map((index) => ({
          type: 'action',
          id: `jev_step_${index}`,
          connector: 'gmail',
          action: 'message.send',
          params: { body: '같은 안내' },
        })),
      },
    }, commandChatContext);

    expect(result.status).toBe('needs_input');
    expect(inputRequestsForResult(result)).toMatchObject([
      {
        id: 'ax-input-jev_step_1-to-0',
        label: '1단계 · 수신자 (1)',
        stepId: 'jev_step_1',
        capabilityId: 'gmail.message.send',
        parameterName: 'to',
      },
      {
        id: 'ax-input-jev_step_2-to-0',
        label: '2단계 · 수신자 (2)',
        stepId: 'jev_step_2',
        capabilityId: 'gmail.message.send',
        parameterName: 'to',
      },
    ]);
    expect(enqueueOnce).not.toHaveBeenCalled();
    db.close();
  });
});
