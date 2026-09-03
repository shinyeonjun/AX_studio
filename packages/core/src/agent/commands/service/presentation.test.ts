import { describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../../../store/db.js';
import { WorkflowStore } from '../../../store/workflow-store.js';
import { AxCommandService } from '../service.js';

describe('AxCommandService presentation validation', () => {

  it('returns structured missing-argument status without inventing a question', async () => {
    const db = await createDatabaseAsync(':memory:');
    const service = new AxCommandService(new WorkflowStore(db));

    const response = await service.execute({ name: 'workflow.inspect' });

    expect(response.status).toBe('invalid');
    expect(response.issues).toEqual([
      expect.objectContaining({ code: 'missing_argument', path: 'args.workflowId' }),
    ]);
    expect(JSON.stringify(response)).not.toContain('?');
  });

  it('validates a bounded presentation without executing a side effect', async () => {
    const db = await createDatabaseAsync(':memory:');
    const service = new AxCommandService(new WorkflowStore(db));

    const response = await service.execute({
      name: 'ui.present',
      args: {
        title: '처리 전에 확인해 주세요',
        blocks: [{ type: 'decision', label: '판단', value: '운영팀 확인' }],
        inputs: [{ id: 'channel', label: 'Slack 채널', type: 'slack_channel' }],
        actions: [{ id: 'continue', label: '진행', value: '진행해줘' }],
      },
    });

    expect(response).toMatchObject({
      command: 'ui.present',
      status: 'ok',
      data: { presentation: { title: '처리 전에 확인해 주세요' } },
    });
    expect(response.inputRequests).toEqual([]);
    expect(new WorkflowStore(db).listWorkflows()).toHaveLength(0);
  });

  it('rejects executable-looking presentation payloads at the command boundary', async () => {
    const db = await createDatabaseAsync(':memory:');
    const service = new AxCommandService(new WorkflowStore(db));

    const response = await service.execute({
      name: 'ui.present',
      args: { title: '잘못된 카드', actions: [{ id: 'run', label: '실행', value: '' }] },
    });

    expect(response).toMatchObject({ command: 'ui.present', status: 'invalid', issues: [{ code: 'invalid_presentation' }] });
  });


});
