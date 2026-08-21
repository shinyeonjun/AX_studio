import { describe, expect, it } from 'vitest';
import { resolveGmailMessageId } from './message-id.js';

describe('resolveGmailMessageId', () => {
  it('reads direct messageId param', () => {
    expect(resolveGmailMessageId({ messageId: 'msg-1' })).toBe('msg-1');
  });

  it('reads nested message.messageId', () => {
    expect(resolveGmailMessageId({ message: { messageId: 'msg-2' } })).toBe('msg-2');
  });

  it('reads nested message.id', () => {
    expect(resolveGmailMessageId({ message: { id: 'msg-3' } })).toBe('msg-3');
  });
});
