import { WebClient } from '@slack/web-api';
import type { Connector, ConnectorContext, ConnectorResult } from '../types.js';
import { pollSlackNewMessages } from './new-message-poll.js';
import { listSlackChannels, readSlackChannelMessages, searchSlackMessages } from './read.js';
import { composeSlackMessagePayload } from './format-message.js';

export class SlackConnector implements Connector {
  name = 'slack';

  constructor(private token: string) {}

  async execute(action: string, params: Record<string, unknown>, ctx: ConnectorContext): Promise<ConnectorResult> {
    try {
      const client = new WebClient(this.token);
      switch (action) {
        case 'message.send': {
          const channel = typeof params.channel === 'string' ? params.channel.trim() : '';
          if (!channel) {
            return { ok: false, error: 'channel_required', errorCode: 'invalid_params' };
          }
          const rawText = (params.text as string) ?? '';
          const payload = composeSlackMessagePayload(rawText, ctx);
          const res = await client.chat.postMessage({
            channel,
            text: payload.text,
            ...(payload.blocks ? { blocks: payload.blocks } : {}),
          });
          ctx.log({ at: new Date().toISOString(), level: 'info', message: 'slack.send', data: { channel: params.channel } });
          return { ok: true, data: res };
        }
        case 'new_message.poll': {
          const poll = await pollSlackNewMessages(client, {
            channel: String(params.channel ?? ''),
            initialized: Boolean(params.initialized),
            lastMessageTs: params.lastMessageTs as string | undefined,
            channelId: params.channelId as string | undefined,
          });
          return { ok: true, data: poll };
        }
        case 'channels.list': {
          const channels = await listSlackChannels(client);
          return { ok: true, data: { channels } };
        }
        case 'messages.search': {
          const query = typeof params.query === 'string' ? params.query.trim() : '';
          if (!query) {
            return { ok: false, error: 'query_required', errorCode: 'invalid_params' };
          }
          const limit = typeof params.limit === 'number' ? params.limit : Number(params.limit);
          const result = await searchSlackMessages(client, query, Number.isFinite(limit) ? limit : 20);
          return { ok: true, data: result };
        }
        case 'messages.read': {
          const channel = typeof params.channel === 'string' ? params.channel.trim() : '';
          if (!channel) {
            return { ok: false, error: 'channel_required', errorCode: 'invalid_params' };
          }
          const limit = typeof params.limit === 'number' ? params.limit : Number(params.limit);
          try {
            const result = await readSlackChannelMessages(
              client,
              channel,
              Number.isFinite(limit) ? limit : 20,
            );
            return { ok: true, data: result };
          } catch (err) {
            const message = (err as Error).message;
            if (message === 'channel_not_found') {
              return { ok: false, error: message, errorCode: 'channel_not_found' };
            }
            throw err;
          }
        }
        default:
          return { ok: false, error: `Unknown slack action: ${action}` };
      }
    } catch (err) {
      return { ok: false, error: (err as Error).message, errorCode: 'slack_error' };
    }
  }
}
