import { describe, expect, it } from 'vitest';
import type { TriggerEvent } from '../../triggers/types.js';
import { slackModulePackage } from './slack.js';

const dedupeKey = (payload: Record<string, unknown>) => {
  const event = { type: 'slack.new_message', payload } as unknown as TriggerEvent;
  return slackModulePackage.pushTriggerDriver!.dedupeKey('wf', event);
};

describe('Slack new-message dedupe key', () => {
  it('keys a message by its Slack id, the same key the poll path writes', () => {
    expect(dedupeKey({ messageId: 'm1', ts: '1.0' })).toBe('wf:slack.new_message:m1');
    expect(dedupeKey({ ts: '1.0' })).toBe('wf:slack.new_message:1.0');
  });

  it('never returns a key that is shared by messages without an id', () => {
    const first = dedupeKey({ text: 'hello' });
    const second = dedupeKey({ text: 'another' });
    expect(first).not.toBe(second);
    expect(first).not.toBe('wf:slack.new_message:');
  });

  it('still recognises the same id-less message on a repeated delivery', () => {
    expect(dedupeKey({ text: 'hello' })).toBe(dedupeKey({ text: 'hello' }));
  });
});
