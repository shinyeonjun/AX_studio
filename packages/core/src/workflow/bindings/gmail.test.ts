import { describe, expect, it } from 'vitest';
import { applyStepBindings, inferWorkflowBindings } from '../bindings.js';

describe('inferWorkflowBindings Gmail trigger', () => {
  it('binds gmail trigger message to messages.read messageId', () => {
    const ir = inferWorkflowBindings({
      id: 'wf',
      name: 'Gmail summary',
      goal: '요약',
      version: 1,
      trigger: { type: 'gmail.new_message', accountId: 'primary' },
      steps: [
        {
          type: 'action',
          id: 'read-mail',
          connector: 'gmail',
          action: 'messages.read',
          params: {},
          sideEffect: 'NONE',
        },
      ],
      inputs: ['messageId', 'from', 'subject', 'snippet', 'sender'],
      permissions: {},
      approval: [],
      allowExternalAuto: true,
      assumptions: [],
      sideEffects: {},
      dataPolicy: {},
    });

    const read = ir.steps.find((step) => step.id === 'read-mail');
    if (!read || read.type !== 'action') throw new Error('missing read step');

    const params = applyStepBindings(
      read,
      ir,
      read.params,
      {},
      {
        messageId: 'gmail-msg-1',
        from: 'naver@mail.com',
        subject: '네이버 메일',
        snippet: '본문 미리보기',
      },
    );

    expect(params.messageId).toBe('gmail-msg-1');
    expect(params.message).toMatchObject({ id: 'gmail-msg-1', messageId: 'gmail-msg-1' });
  });
});
