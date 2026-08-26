import type { Connector, ConnectorContext, ConnectorResult } from '../types.js';

export class MockSlackConnector implements Connector {
  name = 'slack';
  inbound: Array<{ channel: string; text: string; ts: string; user?: string }> = [];
  messages: Array<{ channel: string; text: string }> = [];
  channels: Array<{ id: string; name: string; isPrivate?: boolean }> = [
    { id: 'C_GENERAL', name: 'general' },
    { id: 'C_ALERTS', name: 'alerts', isPrivate: true },
  ];
  channelHistory: Record<string, Array<{ ts: string; text: string; user?: string }>> = {
    C_GENERAL: [
      { ts: '100.001', text: 'hello team', user: 'U1' },
      { ts: '100.002', text: 'deploy finished', user: 'U2' },
    ],
  };
  searchCorpus: Array<{ channelId: string; channel: string; ts: string; text: string; user?: string }> = [
    { channelId: 'C_GENERAL', channel: 'general', ts: '100.002', text: 'deploy finished', user: 'U2' },
  ];

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
                channel,
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
              channel,
              channelId: channel,
              lastMessageTs: latestTs,
            },
          },
        };
      }
      case 'channels.list':
        return { ok: true, data: { channels: this.channels } };
      case 'messages.search': {
        const query = String(params.query ?? '').toLowerCase();
        const matches = this.searchCorpus.filter((entry) => entry.text.toLowerCase().includes(query));
        const hits = matches.map((entry) => ({
          ref: {
            connector: 'slack',
            kind: 'message' as const,
            id: `${entry.channelId}:${entry.ts}`,
            label: `#${entry.channel}`,
          },
          score: 1,
          snippet: entry.text,
        }));
        return {
          ok: true,
          data: {
            hits,
            matches: matches.map((entry) => ({
              channel: entry.channel,
              channelId: entry.channelId,
              ts: entry.ts,
              text: entry.text,
              user: entry.user,
            })),
          },
        };
      }
      case 'messages.read': {
        const channel = String(params.channel ?? '#general');
        const channelId =
          channel.startsWith('C') ? channel : this.channels.find((entry) => `#${entry.name}` === channel || entry.name === channel.replace(/^#/, ''))?.id;
        if (!channelId) {
          return { ok: false, error: 'channel_not_found', errorCode: 'channel_not_found' };
        }
        const messages = this.channelHistory[channelId] ?? [];
        return { ok: true, data: { channel, channelId, messages } };
      }
      default:
        return { ok: false, error: `Unknown slack action: ${action}` };
    }
  }
}
