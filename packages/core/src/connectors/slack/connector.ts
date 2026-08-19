import { WebClient } from '@slack/web-api';
import type { Connector, ConnectorContext, ConnectorResult } from '../types.js';

export class SlackConnector implements Connector {
  name = 'slack';

  constructor(private token: string) {}

  async execute(action: string, params: Record<string, unknown>, ctx: ConnectorContext): Promise<ConnectorResult> {
    if (action !== 'message.send') return { ok: false, error: `Unknown slack action: ${action}` };
    try {
      const client = new WebClient(this.token);
      const res = await client.chat.postMessage({
        channel: (params.channel as string) ?? '#general',
        text: (params.text as string) ?? '',
      });
      ctx.log({ at: new Date().toISOString(), level: 'info', message: 'slack.send', data: { channel: params.channel } });
      return { ok: true, data: res };
    } catch (err) {
      return { ok: false, error: (err as Error).message, errorCode: 'slack_error' };
    }
  }
}
