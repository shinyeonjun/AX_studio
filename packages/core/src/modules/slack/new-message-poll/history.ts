import type { WebClient } from '@slack/web-api';
import { takeUnseenSlackCursor } from '../pagination.js';

type SlackHistoryResponse = Awaited<ReturnType<WebClient['conversations']['history']>>;
export type SlackHistoryMessage = NonNullable<SlackHistoryResponse['messages']>[number];

function isUserMessage(message: { type?: string; subtype?: string; ts?: string; text?: string; user?: string }) {
  return message.type === 'message' && !message.subtype && Boolean(message.ts);
}

export async function collectSlackHistory(
  client: WebClient,
  channelId: string,
  oldest?: string,
): Promise<SlackHistoryMessage[]> {
  const messages: SlackHistoryMessage[] = [];
  const seenMessageTimestamps = new Set<string>();
  let cursor: string | undefined;
  const seenCursors = new Set<string>();
  do {
    const history = await client.conversations.history({
      channel: channelId,
      limit: 100,
      cursor,
      oldest,
    });
    for (const message of (history.messages ?? []).filter(isUserMessage)) {
      if (seenMessageTimestamps.has(message.ts!)) continue;
      seenMessageTimestamps.add(message.ts!);
      messages.push(message);
    }
    cursor = takeUnseenSlackCursor(seenCursors, history.response_metadata?.next_cursor);
  } while (oldest !== undefined && cursor);

  return messages;
}
