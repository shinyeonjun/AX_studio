import { describe, expect, it } from 'vitest';
import { displayForTrigger } from './trigger-display.js';
import type { InterviewDraft } from '../../interview/draft/schema.js';

function gmailDraft(triggerFilter: unknown): InterviewDraft {
  return {
    name: '테스트',
    goal: '네이버 메일 Slack 알림',
    triggerType: 'gmail.new_message',
    gmailAccount: 'primary',
    triggerFilter: triggerFilter as InterviewDraft['triggerFilter'],
    assumptions: [],
    nodes: [],
  };
}

describe('displayForTrigger', () => {
  it('renders normalized and/or trigger filters', () => {
    const display = displayForTrigger(
      gmailDraft({
        op: 'and',
        args: [
          { op: 'contains', left: { ref: 'from' }, right: { lit: 'naver.com' } },
          { op: 'contains', left: { ref: 'subject' }, right: { lit: '메일' } },
        ],
      }),
    );
    expect(display.lines.some((line) => line.text.includes('and('))).toBe(true);
  });

  it('does not throw on legacy malformed and filter shape', () => {
    const display = displayForTrigger(
      gmailDraft({
        op: 'and',
        left: { op: 'contains', left: { ref: 'from' }, right: { lit: 'naver.com' } },
        right: { op: 'contains', left: { ref: 'subject' }, right: { lit: '메일' } },
      }),
    );
    expect(display.lines.some((line) => line.text.includes('and('))).toBe(true);
  });
});
