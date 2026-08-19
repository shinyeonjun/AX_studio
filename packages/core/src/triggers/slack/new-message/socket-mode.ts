import { SocketModeClient } from '@slack/socket-mode';
import { WebClient } from '@slack/web-api';
import type { TriggerEvent } from '../types.js';

export type SlackSocketEventHandler = (event: TriggerEvent) => void;

function isUserMessage(event: Record<string, unknown>): boolean {
  if (event.type !== 'message') return false;
  if (event.subtype) return false;
  if (event.bot_id) return false;
  return Boolean(event.ts && event.channel);
}

export class SlackSocketModeListener {
  private client?: SocketModeClient;
  private web?: WebClient;
  private channelLabels = new Map<string, string>();
  private onEvent?: SlackSocketEventHandler;

  async start(botToken: string, appToken: string, onEvent: SlackSocketEventHandler): Promise<void> {
    await this.stop();

    this.onEvent = onEvent;
    this.client = new SocketModeClient({ appToken });
    this.web = new WebClient(botToken);

    this.client.on('events_api', async ({ event, ack }) => {
      await ack();
      if (!isUserMessage(event as Record<string, unknown>)) return;

      const message = event as {
        type: 'message';
        channel: string;
        ts: string;
        text?: string;
        user?: string;
      };

      const channelId = message.channel;
      const channel = await this.resolveChannelLabel(channelId);

      this.onEvent?.({
        type: 'slack.new_message',
        payload: {
          messageId: message.ts,
          ts: message.ts,
          channel,
          channelId,
          text: message.text ?? '',
          user: message.user,
          sender: message.user,
        },
      });
    });

    await this.client.start();
  }

  async stop(): Promise<void> {
    if (this.client) {
      await this.client.disconnect();
    }
    this.client = undefined;
    this.web = undefined;
    this.onEvent = undefined;
    this.channelLabels.clear();
  }

  isRunning(): boolean {
    return Boolean(this.client);
  }

  private async resolveChannelLabel(channelId: string): Promise<string> {
    const cached = this.channelLabels.get(channelId);
    if (cached) return cached;

    try {
      const response = await this.web?.conversations.info({ channel: channelId });
      const name = response?.channel?.name;
      const label = name ? `#${name}` : channelId;
      this.channelLabels.set(channelId, label);
      return label;
    } catch {
      return channelId;
    }
  }
}
