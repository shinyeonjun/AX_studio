import type { WorkflowIR } from '../../../workflow/schema.js';

export const gmailNotifySkill: WorkflowIR = {
  name: '새 메일 알림',
  goal: '새 Gmail 도착 시 Slack 알림',
  version: 1,
  trigger: { type: 'gmail.new_message', accountId: 'primary' },
  inputs: ['from', 'subject', 'body'],
  steps: [
    {
      type: 'action',
      id: 'notify',
      connector: 'slack',
      action: 'message.send',
      params: { channel: '#inbox', text: 'new mail' },
      sideEffect: 'EXTERNAL',
    },
  ],
  permissions: {},
  approval: [],
  allowExternalAuto: true,
  assumptions: [],
  sideEffects: {},
  dataPolicy: {},
};
