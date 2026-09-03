import type { gmail_v1 } from 'googleapis';
import { describe, expect, it, vi } from 'vitest';
import { pollGmailNewMessages } from '../../new-message-poll.js';

describe('pollGmailNewMessages history pagination', () => {
  it('collects every history page and emits each new message once', async () => {
    const historyList = vi
      .fn()
      .mockResolvedValueOnce({
        data: {
          historyId: '103',
          nextPageToken: 'page-2',
          history: [
            { messagesAdded: [{ message: { id: 'message-1' } }] },
            { messagesAdded: [{ message: { id: 'message-1' } }] },
            { messagesAdded: [{ message: { id: 'already-seen' } }] },
          ],
        },
      })
      .mockResolvedValueOnce({
        data: {
          historyId: '105',
          history: [
            { messagesAdded: [{ message: { id: 'message-2' } }] },
            { messagesAdded: [{ message: { id: 'message-1' } }] },
          ],
        },
      });
    const messageGet = vi.fn(async ({ id }: { id: string }) => ({
      data: {
        labelIds: ['INBOX'],
        snippet: `snippet ${id}`,
        payload: { headers: [{ name: 'From', value: `${id}@example.com` }] },
      },
    }));
    const gmail = {
      users: {
        history: { list: historyList },
        messages: { get: messageGet },
      },
    } as unknown as gmail_v1.Gmail;

    const result = await pollGmailNewMessages(gmail, {
      initialized: true,
      historyId: '100',
      seenMessageIds: ['already-seen'],
    });

    expect(historyList).toHaveBeenNthCalledWith(1, {
      userId: 'me',
      startHistoryId: '100',
      historyTypes: ['messageAdded'],
      pageToken: undefined,
    });
    expect(historyList).toHaveBeenNthCalledWith(2, {
      userId: 'me',
      startHistoryId: '100',
      historyTypes: ['messageAdded'],
      pageToken: 'page-2',
    });
    expect(messageGet.mock.calls.map(([request]) => request.id)).toEqual([
      'message-1',
      'message-2',
    ]);
    expect(result.events.map((event) => event.payload.messageId)).toEqual([
      'message-1',
      'message-2',
    ]);
    expect(result.cursor).toEqual({
      initialized: true,
      historyId: '105',
      seenMessageIds: ['already-seen', 'message-1', 'message-2'],
    });
  });
});
