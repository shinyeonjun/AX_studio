export interface SlackNewMessagePollParams {
  channel: string;
  initialized: boolean;
  lastMessageTs?: string;
  cursorChannel?: string;
  channelId?: string;
}

export interface SlackNewMessageEvent {
  type: 'slack.new_message';
  payload: {
    messageId: string;
    ts: string;
    channel: string;
    channelId: string;
    text: string;
    user?: string;
    sender?: string;
  };
}

export interface SlackNewMessagePollResult {
  events: SlackNewMessageEvent[];
  cursor: {
    initialized: boolean;
    channel: string;
    channelId?: string;
    lastMessageTs?: string;
  };
}
