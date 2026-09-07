import type { SlackHistoryMessage } from './history.js';
import type { SlackNewMessageEvent } from './contracts.js';

export function toSlackNewMessageEvent(
  message: SlackHistoryMessage,
  channel: string,
  channelId: string,
): SlackNewMessageEvent {
  return {
    type: 'slack.new_message',
    payload: {
      messageId: message.ts!,
      ts: message.ts!,
      channel,
      channelId,
      text: message.text ?? '',
      user: message.user,
      sender: message.user,
    },
  };
}
