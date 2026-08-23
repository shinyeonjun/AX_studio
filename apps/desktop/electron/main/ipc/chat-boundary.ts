import {
  AxInputRequestSchema,
  AxUiPresentationSchema,
  type AxInputRequest,
  type AxUiPresentation,
} from '@ax-studio/core';

export type DesktopChatMessage = {
  role: 'user' | 'assistant';
  content: string;
  inputRequests?: AxInputRequest[];
  presentations?: AxUiPresentation[];
};

const MAX_CHAT_MESSAGES = 100;
const MAX_CHAT_MESSAGE_CHARS = 50_000;
const MAX_CHAT_TOTAL_CHARS = 250_000;

export function boundedText(value: unknown, field: string, max = MAX_CHAT_MESSAGE_CHARS): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${field}을(를) 입력해 주세요.`);
  }
  if (value.length > max) {
    throw new Error(`${field}이(가) 너무 깁니다. ${max.toLocaleString()}자 이내로 입력해 주세요.`);
  }
  return value;
}

/** Validate untrusted renderer input before it reaches a provider or database. */
export function normalizeChatMessages(value: unknown): DesktopChatMessage[] {
  if (!Array.isArray(value)) throw new Error('대화 기록 형식이 올바르지 않습니다.');
  if (value.length > MAX_CHAT_MESSAGES) {
    throw new Error(`대화 기록은 ${MAX_CHAT_MESSAGES}개 메시지까지 보낼 수 있습니다.`);
  }

  let totalChars = 0;
  return value.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`대화 ${index + 1}번째 메시지 형식이 올바르지 않습니다.`);
    }
    const record = entry as Record<string, unknown>;
    if (record.role !== 'user' && record.role !== 'assistant') {
      throw new Error(`대화 ${index + 1}번째 메시지 역할이 올바르지 않습니다.`);
    }
    if (typeof record.content !== 'string') {
      throw new Error(`대화 ${index + 1}번째 메시지 내용이 올바르지 않습니다.`);
    }
    if (record.content.length > MAX_CHAT_MESSAGE_CHARS) {
      throw new Error(`대화 ${index + 1}번째 메시지가 너무 깁니다.`);
    }
    totalChars += record.content.length;
    if (totalChars > MAX_CHAT_TOTAL_CHARS) {
      throw new Error(`대화 기록이 너무 큽니다. ${MAX_CHAT_TOTAL_CHARS.toLocaleString()}자 이내로 줄여 주세요.`);
    }
    const inputRequests = record.inputRequests === undefined
      ? undefined
      : AxInputRequestSchema.array().max(8).safeParse(record.inputRequests);
    if (inputRequests && !inputRequests.success) {
      throw new Error(`대화 ${index + 1}번째 메시지 입력 요청 형식이 올바르지 않습니다.`);
    }
    const presentations = record.presentations === undefined
      ? undefined
      : AxUiPresentationSchema.array().max(4).safeParse(record.presentations);
    if (presentations && !presentations.success) {
      throw new Error(`대화 ${index + 1}번째 메시지 UI 형식이 올바르지 않습니다.`);
    }
    return {
      role: record.role,
      content: record.content,
      ...(inputRequests ? { inputRequests: inputRequests.data } : {}),
      ...(presentations ? { presentations: presentations.data } : {}),
    };
  });
}

export function requireLastUserMessage(messages: DesktopChatMessage[]): string {
  const last = messages.at(-1);
  if (!last || last.role !== 'user' || !last.content.trim()) {
    throw new Error('사용자 메시지가 필요합니다.');
  }
  return last.content.trim();
}
