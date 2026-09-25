import { describe, expect, it } from 'vitest';
import type { AxCommand } from '../schema.js';
import { applyJevCommandInputValuesToCommand } from './jev-action-catalog.js';

describe('Jev command input continuation', () => {
  it('applies scoped answers to an upserted action in workflow.update', () => {
    const pending: AxCommand = {
      name: 'workflow.update',
      args: {
        workflowId: 'workflow-1',
        baseVersion: 4,
        operations: [
          { op: 'set', path: 'name', value: '메일 업무' },
          {
            op: 'upsert_step',
            step: {
              type: 'action',
              id: 'jev_step_2',
              connector: 'gmail',
              action: 'message.send',
              actionRef: 'gmail.message.send@1',
              params: {},
            },
          },
          { op: 'remove_step', stepId: 'obsolete-step' },
        ],
      },
    };

    expect(applyJevCommandInputValuesToCommand(pending, [
      {
        label: '수신자', value: 'person@example.com', stepId: 'jev_step_2',
        capabilityId: 'gmail.message.send', parameterName: 'to',
      },
      {
        label: '본문', value: '견적 안내', stepId: 'jev_step_2',
        capabilityId: 'gmail.message.send', parameterName: 'body',
      },
      {
        label: '본문', value: '엉뚱한 단계에는 적용하지 않음', stepId: 'jev_step_1',
        capabilityId: 'gmail.message.send', parameterName: 'body',
      },
    ])).toEqual({
      name: 'workflow.update',
      args: {
        workflowId: 'workflow-1',
        baseVersion: 4,
        operations: [
          { op: 'set', path: 'name', value: '메일 업무' },
          {
            op: 'upsert_step',
            step: expect.objectContaining({
              id: 'jev_step_2',
              params: { to: 'person@example.com', body: '견적 안내' },
            }),
          },
          { op: 'remove_step', stepId: 'obsolete-step' },
        ],
      },
    });
  });
});
