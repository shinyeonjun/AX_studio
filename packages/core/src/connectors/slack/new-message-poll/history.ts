import type { WebClient } from '@slack/web-api';
import { nextSlackHistoryPage } from '../pagination.js';
import { slackRequest } from '../request.js';

type SlackHistoryResponse = Awaited<ReturnType<WebClient['conversations']['history']>>;
export type SlackHistoryMessage = NonNullable<SlackHistoryResponse['messages']>[number];

function isUserMessage(message: { type?: string; subtype?: string; ts?: string; text?: string; user?: string }) {
  return message.type === 'message' && !message.subtype && Boolean(message.ts);
}

export const SLACK_HISTORY_SCAN_LIMIT = 10_000;

export async function collectSlackHistory(
  client: WebClient,
  channelId: string,
  oldest?: string,
  signal?: AbortSignal,
): Promise<SlackHistoryMessage[]> {
  const messages: SlackHistoryMessage[] = [];
  const seenMessageTimestamps = new Set<string>();
  let page: { cursor?: string; latest?: string } | undefined;
  const seenCursors = new Set<string>();
  do {
    const history = await slackRequest(() => client.conversations.history({
      channel: channelId,
      limit: 100,
      cursor: page?.cursor,
      oldest,
      ...(page?.latest ? { latest: page.latest } : {}),
    }), signal);
    for (const message of (history.messages ?? []).filter(isUserMessage)) {
      if (seenMessageTimestamps.has(message.ts!)) continue;
      // Bounds one scan; a poll then handles the oldest messages first (see SLACK_POLL_BATCH).
      if (messages.length >= SLACK_HISTORY_SCAN_LIMIT) throw new Error('message_limit');
      seenMessageTimestamps.add(message.ts!);
      messages.push(message);
    }
    page = oldest === undefined ? undefined : nextSlackHistoryPage(seenCursors, history, page?.latest);
  } while (page);

  return messages;
}
