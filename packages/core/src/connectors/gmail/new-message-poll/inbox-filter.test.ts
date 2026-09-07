import type { gmail_v1 } from 'googleapis';
import { describe, expect, it, vi } from 'vitest';
import { pollGmailNewMessages } from '../new-message-poll.js';

describe('pollGmailNewMessages inbox filtering', () => {
  it('ignores messages outside the inbox while advancing the cursor', async () => {
    const messageGet = vi
      .fn()
      .mockResolvedValueOnce({
        data: {
          labelIds: ['SENT'],
          snippet: 'sent message',
          payload: { headers: [{ name: 'From', value: 'me@example.com' }] },
        },
      })
      .mockResolvedValueOnce({
        data: {
          labelIds: ['INBOX', 'UNREAD'],
          snippet: 'received message',
          payload: { headers: [{ name: 'From', value: 'sender@example.com' }] },
        },
      });
    const gmail = {
      users: {
        history: {
          list: vi.fn().mockResolvedValue({
            data: {
              historyId: '103',
              history: [
                { messagesAdded: [{ message: { id: 'sent-message' } }] },
                { messagesAdded: [{ message: { id: 'inbox-message' } }] },
              ],
            },
          }),
        },
        messages: { get: messageGet },
      },
    } as unknown as gmail_v1.Gmail;

    const result = await pollGmailNewMessages(gmail, {
      initialized: true,
      historyId: '100',
      seenMessageIds: [],
    });

    expect(result.events.map((event) => event.payload.messageId)).toEqual(['inbox-message']);
    expect(result.cursor).toEqual({
      initialized: true,
      historyId: '103',
      seenMessageIds: ['sent-message', 'inbox-message'],
    });
  });
});
