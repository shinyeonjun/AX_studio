import type { Connector, ConnectorContext, ConnectorResult } from '../types.js';

export class MockSlackConnector implements Connector {
  name = 'slack';
  inbound: Array<{ channel: string; text: string; ts: string; user?: string }> = [];
  messages: Array<{ channel: string; text: string }> = [];

  async execute(action: string, params: Record<string, unknown>, ctx: ConnectorContext): Promise<ConnectorResult> {
    switch (action) {
      case 'message.send': {
        const msg = { channel: (params.channel as string) ?? '#general', text: (params.text as string) ?? '' };
        this.messages.push(msg);
        ctx.log({ at: new Date().toISOString(), level: 'info', message: 'slack.send', data: msg });
        return { ok: true, data: msg };
      }
      case 'new_message.poll': {
        const channel = String(params.channel ?? '#general');
        const initialized = Boolean(params.initialized);
        const lastMessageTs = (params.lastMessageTs as string | undefined) ?? '0';
        const channelMessages = this.inbound
          .filter((message) => message.channel === channel)
          .sort((a, b) => (a.ts < b.ts ? -1 : 1));

        if (!initialized) {
          const latest = channelMessages[channelMessages.length - 1];
          return {
            ok: true,
            data: {
              events: [],
              cursor: {
                initialized: true,
                channelId: channel,
                lastMessageTs: latest?.ts ?? lastMessageTs,
              },
            },
          };
        }

        const newMessages = channelMessages.filter((message) => message.ts > lastMessageTs);
        const events = newMessages.map((message) => ({
          type: 'slack.new_message' as const,
          payload: {
            messageId: message.ts,
            ts: message.ts,
            channel,
            channelId: channel,
            text: message.text,
            user: message.user,
            sender: message.user,
          },
        }));
        const latestTs =
          newMessages.length > 0 ? newMessages[newMessages.length - 1]?.ts ?? lastMessageTs : lastMessageTs;

        return {
          ok: true,
          data: {
            events,
            cursor: {
              initialized: true,
              channelId: channel,
              lastMessageTs: latestTs,
            },
          },
        };
      }
      default:
        return { ok: false, error: `Unknown slack action: ${action}` };
    }
  }
}
