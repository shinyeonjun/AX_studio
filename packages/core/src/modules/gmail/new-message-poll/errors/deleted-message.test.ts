import type { gmail_v1 } from 'googleapis';
import { describe, expect, it, vi } from 'vitest';
import { pollGmailNewMessages } from '../../new-message-poll.js';
describe('Gmail deleted message handling', () => {
  it('skips messages deleted after history listing without dropping later events', async () => {
    const messageGet = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('Requested entity was not found'), { status: 404 }))
      .mockResolvedValueOnce({ data: { labelIds: ['INBOX'], snippet: 'available message', payload: { headers: [{ name: 'From', value: 'sender@example.com' }] } } });
    const gmail = { users: { history: { list: vi.fn().mockResolvedValue({ data: { historyId: '103', history: [{ messagesAdded: [{ message: { id: 'deleted-message' } }, { message: { id: 'available-message' } }] }] } }) }, messages: { get: messageGet } } } as unknown as gmail_v1.Gmail;
    const result = await pollGmailNewMessages(gmail, { initialized: true, historyId: '100', seenMessageIds: [] });
    expect(result.events.map((event) => event.payload.messageId)).toEqual(['available-message']);
    expect(result.cursor).toEqual({ initialized: true, historyId: '103', seenMessageIds: ['deleted-message', 'available-message'] });
  });
});
