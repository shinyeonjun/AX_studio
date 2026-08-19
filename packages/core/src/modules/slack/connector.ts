import { WebClient } from '@slack/web-api';
import type { Connector, ConnectorContext, ConnectorResult } from '../types.js';
import { pollSlackNewMessages } from './new-message-poll.js';
import { composeSlackMessagePayload } from './format-message.js';

export class SlackConnector implements Connector {
  name = 'slack';

  constructor(private token: string) {}

  async execute(action: string, params: Record<string, unknown>, ctx: ConnectorContext): Promise<ConnectorResult> {
    try {
      const client = new WebClient(this.token);
      switch (action) {
        case 'message.send': {
          const rawText = (params.text as string) ?? '';
          const payload = composeSlackMessagePayload(rawText, ctx);
          const res = await client.chat.postMessage({
            channel: (params.channel as string) ?? '#general',
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
        default:
          return { ok: false, error: `Unknown slack action: ${action}` };
      }
    } catch (err) {
      return { ok: false, error: (err as Error).message, errorCode: 'slack_error' };
    }
  }
}
