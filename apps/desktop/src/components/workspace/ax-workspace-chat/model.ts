import type {
  AppendMessage,
  ThreadMessageLike,
} from '@assistant-ui/react';
import type { WorkspaceChatMessage } from '@ax-studio/core';

export const WELCOME_EXAMPLES: Array<{ label: string; text: string }> = [
  { label: '말로 만들기', text: 'Gmail 새 메일이 오면 내용을 요약해서 Slack으로 알려주는 반복 업무를 만들어줘' },
  { label: '연결 확인', text: '연결된 폴더에 어떤 파일이 있어?' },
];

export function toThreadMessages(messages: WorkspaceChatMessage[]): ThreadMessageLike[] {
  return messages.map((message, index) => ({
    id: 'ax-msg-' + index,
    role: message.role,
    content: [{ type: 'text' as const, text: message.content }],
  }));
}

export function appendText(message: AppendMessage): string {
  return message.content
    .filter((part): part is Extract<typeof part, { type: 'text' }> => part.type === 'text')
    .map((part) => part.text)
    .join('')
    .trim();
}
