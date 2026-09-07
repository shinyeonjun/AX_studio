export interface GmailNewMessagePollParams {
  initialized: boolean;
  seenMessageIds: string[];
  historyId?: string;
}

export interface GmailNewMessageEvent {
  type: 'gmail.new_message';
  payload: {
    messageId: string;
    from: string;
    subject: string;
    snippet: string;
    sender: string;
  };
}

export interface GmailNewMessagePollResult {
  events: GmailNewMessageEvent[];
  cursor: {
    initialized: boolean;
    seenMessageIds: string[];
    historyId?: string;
  };
}
