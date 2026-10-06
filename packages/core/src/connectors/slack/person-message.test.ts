import { describe, expect, it } from 'vitest';
import { isMessageWithText } from './person-message.js';

describe('which Slack messages a read or trigger sees', () => {
  it.each([
    [{ type: 'message', ts: '1' }, true],
    [{ type: 'message', subtype: 'file_share', ts: '1' }, true],
    [{ type: 'message', subtype: 'thread_broadcast', ts: '1' }, true],
    [{ type: 'message', subtype: 'channel_join', ts: '1' }, false],
    [{ type: 'message', subtype: 'message_deleted', ts: '1' }, false],
    [{ type: 'message', subtype: 'bot_message', ts: '1' }, false],
    [{ type: 'reaction_added', ts: '1' }, false],
  ] as const)('%j → %s', (message, expected) => {
    expect(isMessageWithText(message)).toBe(expected);
  });
});
