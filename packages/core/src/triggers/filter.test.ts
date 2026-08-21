import { describe, expect, it } from 'vitest';
import { matchesTriggerFilter } from './filter.js';

describe('trigger filters', () => {
  const trigger = {
    type: 'gmail.new_message' as const,
    accountId: 'primary',
    filter: {
      op: 'and' as const,
      args: [
        { op: 'eq' as const, left: { ref: 'from' }, right: { lit: 'sender@example.com' } },
        { op: 'contains' as const, left: { ref: 'subject' }, right: { lit: '[보고]' } },
      ],
    },
  };

  it('allows matching events through', () => {
    expect(
      matchesTriggerFilter(trigger, {
        type: 'gmail.new_message',
        payload: { from: 'sender@example.com', subject: '[보고] 주간 현황' },
      }),
    ).toBe(true);
  });

  it('blocks non-matching events before workflow execution', () => {
    expect(
      matchesTriggerFilter(trigger, {
        type: 'gmail.new_message',
        payload: { from: 'other@example.com', subject: '[보고] 주간 현황' },
      }),
    ).toBe(false);
  });

  it('keeps unfiltered triggers backward compatible', () => {
    expect(
      matchesTriggerFilter(
        { type: 'gmail.new_message', accountId: 'primary' },
        { type: 'gmail.new_message', payload: {} },
      ),
    ).toBe(true);
  });
});
