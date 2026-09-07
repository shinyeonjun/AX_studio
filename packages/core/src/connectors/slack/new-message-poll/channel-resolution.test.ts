import type { WebClient } from '@slack/web-api';
import { describe, expect, it, vi } from 'vitest';
import { pollSlackNewMessages } from '../new-message-poll.js';

describe('pollSlackNewMessages', () => {
  it('resolves and baselines a newly configured channel instead of reusing the old channel id', async () => {
    const history = vi.fn().mockResolvedValue({
      messages: [{ type: 'message', ts: '300.000', text: 'existing', user: 'U1' }],
      response_metadata: { next_cursor: '' },
    });
    const list = vi.fn().mockResolvedValue({
      channels: [{ id: 'C_RANDOM', name: 'random' }],
      response_metadata: { next_cursor: '' },
    });
    const client = { conversations: { history, list } } as unknown as WebClient;

    const result = await pollSlackNewMessages(client, {
      channel: '#random',
      cursorChannel: '#general',
      channelId: 'C_GENERAL',
      initialized: true,
      lastMessageTs: '200.000',
    });

    expect(list).toHaveBeenCalledOnce();
    expect(history).toHaveBeenCalledWith({
      channel: 'C_RANDOM',
      limit: 100,
      cursor: undefined,
      oldest: undefined,
    });
    expect(result).toEqual({
      events: [],
      cursor: {
        initialized: true,
        channel: '#random',
        channelId: 'C_RANDOM',
        lastMessageTs: '300.000',
      },
    });
  });

  it('upgrades a legacy cursor without rebaselining when its channel id still matches', async () => {
    const history = vi.fn().mockResolvedValue({
      messages: [{ type: 'message', ts: '201.000', text: 'new', user: 'U1' }],
      response_metadata: { next_cursor: '' },
    });
    const list = vi.fn().mockResolvedValue({
      channels: [{ id: 'C_GENERAL', name: 'general' }],
      response_metadata: { next_cursor: '' },
    });
    const client = { conversations: { history, list } } as unknown as WebClient;

    const result = await pollSlackNewMessages(client, {
      channel: '#general',
      channelId: 'C_GENERAL',
      initialized: true,
      lastMessageTs: '200.000',
    });

    expect(history).toHaveBeenCalledWith(expect.objectContaining({
      channel: 'C_GENERAL',
      oldest: '200.000',
    }));
    expect(result.events.map((event) => event.payload.messageId)).toEqual(['201.000']);
    expect(result.cursor.channel).toBe('#general');
  });
});
