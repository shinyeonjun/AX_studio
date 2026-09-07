import type { gmail_v1 } from 'googleapis';
import { describe, expect, it, vi } from 'vitest';
import { pollGmailNewMessages } from '../poll.js';

describe('pollGmailNewMessages history cycle guard', () => {
  it('rejects cyclic history without hydrating messages or advancing the checkpoint', async () => {
    const historyList = vi
      .fn()
      .mockResolvedValueOnce({
        data: {
          historyId: '101',
          nextPageToken: 'page-2',
          history: [{ messagesAdded: [{ message: { id: 'message-1' } }] }],
        },
      })
      .mockResolvedValueOnce({
        data: {
          historyId: '102',
          nextPageToken: 'page-1',
          history: [{ messagesAdded: [{ message: { id: 'message-2' } }] }],
        },
      })
      .mockResolvedValueOnce({
        data: {
          historyId: '103',
          nextPageToken: 'page-2',
          history: [{ messagesAdded: [{ message: { id: 'message-3' } }] }],
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

    await expect(pollGmailNewMessages(gmail, {
      initialized: true,
      historyId: '100',
      seenMessageIds: [],
    })).rejects.toThrow('pagination_cycle');

    expect(historyList).toHaveBeenCalledTimes(3);
    expect(historyList.mock.calls.map(([request]) => request.pageToken)).toEqual([
      undefined,
      'page-2',
      'page-1',
    ]);
    expect(messageGet).not.toHaveBeenCalled();
  });
});
