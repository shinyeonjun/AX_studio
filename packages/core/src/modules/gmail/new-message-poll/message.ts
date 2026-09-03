import type { gmail_v1 } from 'googleapis';
import type { GmailNewMessageEvent } from './contracts.js';
import { isNotFoundError } from './shared.js';

function headerValue(headers: gmail_v1.Schema$MessagePartHeader[] | undefined, name: string): string {
  return headers?.find((header) => header.name?.toLowerCase() === name.toLowerCase())?.value ?? '';
}

export async function messageEvent(
  gmail: gmail_v1.Gmail,
  messageId: string,
): Promise<GmailNewMessageEvent | undefined> {
  let res;
  try {
    res = await gmail.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'metadata',
      metadataHeaders: ['From', 'Subject'],
    });
  } catch (error) {
    // A message can be deleted after it appears in history but before polling.
    if (isNotFoundError(error)) return undefined;
    throw error;
  }
  if (!res.data.labelIds?.includes('INBOX')) return undefined;

  const from = headerValue(res.data.payload?.headers, 'From');
  const subject = headerValue(res.data.payload?.headers, 'Subject');
  const snippet = res.data.snippet ?? '';
  return {
    type: 'gmail.new_message',
    payload: {
      messageId,
      from,
      subject,
      snippet,
      sender: from,
    },
  };
}
