import type { gmail_v1 } from 'googleapis';
import { describe, expect, it, vi } from 'vitest';
import { pollGmailNewMessages } from '../../new-message-poll.js';
describe('Gmail history errors', () => {
  it('does not treat a non-404 history failure mentioning historyId as an expired cursor', async () => {
    const failure = Object.assign(new Error('service unavailable while reading historyId'), { code: 503 });
    const profileGet = vi.fn();
    const messageList = vi.fn();
    const gmail = { users: { getProfile: profileGet, history: { list: vi.fn().mockRejectedValue(failure) }, messages: { list: messageList } } } as unknown as gmail_v1.Gmail;
    await expect(pollGmailNewMessages(gmail, { initialized: true, historyId: '100', seenMessageIds: [] })).rejects.toBe(failure);
    expect(profileGet).not.toHaveBeenCalled();
    expect(messageList).not.toHaveBeenCalled();
  });
});
