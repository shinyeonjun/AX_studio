import { describe, expect, it } from 'vitest';
import { assessCompleteness } from '../../workflow/canvas/slots/requiredness.js';

describe('requiredness', () => {
  it('requires recipient for gmail send', () => {
    const missing = assessCompleteness(
      {
        goal: '테스트 메일',
        success: '발송',
        trigger: { type: 'once', runAt: '2026-08-19T10:00:00.000Z' },
        steps: [
          {
            type: 'action',
            id: 'send',
            connector: 'gmail',
            action: 'message.send',
            params: {},
            sideEffect: 'EXTERNAL_HIGH',
          },
          {
            type: 'human_approval',
            id: 'approve',
            reason: '발송',
            forActionIds: ['send'],
          },
        ],
      },
      ['gmail'],
    );
    expect(missing.missingRequired).toContain('send.params.to');
  });
});
