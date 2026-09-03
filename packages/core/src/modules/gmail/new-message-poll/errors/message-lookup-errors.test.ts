import type { gmail_v1 } from 'googleapis';
import { describe, expect, it, vi } from 'vitest';
import { pollGmailNewMessages } from '../../new-message-poll.js';
describe('Gmail message lookup errors', () => {
  it('propagates non-404 message lookup failures', async () => {
    const failure = Object.assign(new Error('service unavailable'), { code: 503 });
    const gmail = { users: { history: { list: vi.fn().mockResolvedValue({ data: { historyId: '103', history: [{ messagesAdded: [{ message: { id: 'message-1' } }] }] } }) }, messages: { get: vi.fn().mockRejectedValue(failure) } } } as unknown as gmail_v1.Gmail;
    await expect(pollGmailNewMessages(gmail, { initialized: true, historyId: '100', seenMessageIds: [] })).rejects.toBe(failure);
  });
  it('does not treat a non-404 failure mentioning 404 as a deleted message', async () => {
    const failure = Object.assign(new Error('upstream 503 while reading message 404-report'), { code: 503 });
    const gmail = { users: { history: { list: vi.fn().mockResolvedValue({ data: { historyId: '103', history: [{ messagesAdded: [{ message: { id: 'message-1' } }] }] } }) }, messages: { get: vi.fn().mockRejectedValue(failure) } } } as unknown as gmail_v1.Gmail;
    await expect(pollGmailNewMessages(gmail, { initialized: true, historyId: '100', seenMessageIds: [] })).rejects.toBe(failure);
  });
});
