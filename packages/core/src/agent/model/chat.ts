export type ChatRole = 'user' | 'assistant';

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ChatPromptInput {
  system: string;
  user?: string;
  messages?: ChatMessage[];
}

export function chatMessagesFromInput(input: ChatPromptInput): ChatMessage[] {
  if (input.messages && input.messages.length > 0) return normalizeChatMessages(input.messages);
  if (input.user?.trim()) return [{ role: 'user', content: input.user }];
  throw new Error('Model call requires user or messages');
}

/** Anthropic/OpenAI chat APIs require alternating roles starting with user. */
export function normalizeChatMessages(messages: ChatMessage[]): ChatMessage[] {
  const merged: ChatMessage[] = [];
  for (const message of messages) {
    const content = message.content.trim();
    if (!content) continue;
    const last = merged[merged.length - 1];
    if (last && last.role === message.role) {
      last.content = `${last.content}\n\n${content}`;
    } else {
      merged.push({ role: message.role, content });
    }
  }
  if (merged[0]?.role === 'assistant') {
    merged.unshift({ role: 'user', content: '(conversation start)' });
  }
  return merged;
}

export function flattenChatPrompt(system: string, messages: ChatMessage[]): string {
  const body = messages
    .map((message) => `${message.role === 'user' ? 'User' : 'Assistant'}: ${message.content}`)
    .join('\n\n');
  return `${system}\n\n${body}`;
}
