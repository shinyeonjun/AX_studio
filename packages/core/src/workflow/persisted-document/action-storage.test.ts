import { describe, expect, it } from 'vitest';
import { splitWorkflowIR, parseStoredWorkflow, WORKFLOW_DOCUMENT_FORMAT } from '../persisted-document.js';
import { parseWorkflowIR } from '../schema.js';

describe('persisted workflow document action storage', () => {
  it('splits action params into actions map and keeps graph steps structural', () => {
    const ir = parseWorkflowIR({
      name: '알림',
      goal: '등급별 알림',
      version: 1,
      trigger: { type: 'manual' },
      steps: [
        {
          type: 'action',
          id: 'critical_slack',
          connector: 'slack',
          action: 'message.send',
          params: { channel: '#ax', text: 'critical' },
          sideEffect: 'EXTERNAL',
        },
        {
          type: 'ai_decision',
          id: 'classify',
          goal: '분류',
          memo: 'critical=긴급',
        },
      ],
      permissions: {},
      approval: [],
      allowExternalAuto: true,
      dataPolicy: { emailBody: { cloudAllowed: false } },
      sideEffects: { critical_slack: 'EXTERNAL' },
    });

    const document = splitWorkflowIR(ir);
    expect(document.format).toBe(WORKFLOW_DOCUMENT_FORMAT);
    expect(document.workflow.steps).toEqual([
      { type: 'action', id: 'critical_slack' },
      expect.objectContaining({ type: 'ai_decision', id: 'classify', memo: 'critical=긴급' }),
    ]);
    expect(document.actions.critical_slack).toMatchObject({
      params: { channel: '#ax', text: 'critical' },
    });
  });

  it('rejects an action that is not present in the capability catalog', () => {
    expect(() => parseStoredWorkflow({
      format: WORKFLOW_DOCUMENT_FORMAT,
      workflow: {
        name: '잘못된 업무',
        goal: '실행 불가 액션',
        steps: [{ type: 'action', id: 'unknown' }],
      },
      actions: {
        unknown: {
          actionRef: 'missing.action@1',
          connector: 'missing',
          action: 'action',
          params: {},
        },
      },
    })).toThrow('action capability not found');
  });
});
