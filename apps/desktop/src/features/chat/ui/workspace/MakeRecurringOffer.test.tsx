import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { WorkspaceChatMessage } from '@ax-studio/core';
import { encodeScheduleInputValue } from '@ax-studio/core/schedule';
import { AssistantMessage, UserMessage } from './ax-workspace-chat/messages';

const result = (overrides: Partial<WorkspaceChatMessage> = {}): WorkspaceChatMessage => ({
  role: 'assistant',
  kind: 'execution_result',
  content: '재고 10개 미만 상품 3개를 Slack으로 보냈습니다.',
  executionId: 'exec-1',
  executionStatus: 'success',
  ...overrides,
} as WorkspaceChatMessage);

function render(
  message: WorkspaceChatMessage,
  onMakeRecurring?: (source: { executionId: string } | { latestRead: true }, value: string) => Promise<void>,
  isLatestRead = false,
): string {
  return renderToStaticMarkup(
    <AssistantMessage message={message} busy={false} isLatest onSend={vi.fn()} onMakeRecurring={onMakeRecurring} isLatestRead={isLatestRead} />,
  );
}

const readAnswer = {
  role: 'assistant',
  content: 'title | stock',
  readResult: { id: 't', kind: 'table', columns: [{ name: 'title', type: 'string', nullable: false, inferred: true }], rows: [], truncated: false },
} as unknown as WorkspaceChatMessage;

describe('"이걸 반복 업무로 만들기" offer', () => {
  const onMakeRecurring = vi.fn(async () => undefined);

  it('appears under a successful one-off result', () => {
    expect(render(result(), onMakeRecurring)).toContain('이걸 반복 업무로 만들기');
  });

  it.each([
    ['a failed run', result({ executionStatus: 'failed' })],
    ['a run waiting for approval', result({ executionStatus: 'pending_approval' })],
    ['a result without its run', result({ executionId: undefined })],
    ['an ordinary answer', { role: 'assistant', content: '안녕하세요' } as WorkspaceChatMessage],
  ])('does not appear for %s', (_name, message) => {
    expect(render(message, onMakeRecurring)).not.toContain('반복 업무로 만들기');
  });

  it('appears under the latest read answer only, whose recipe the host still holds', () => {
    expect(render(readAnswer, onMakeRecurring, true)).toContain('이걸 반복 업무로 만들기');
    expect(render(readAnswer, onMakeRecurring, false)).not.toContain('반복 업무로 만들기');
  });

  it('does not appear in a conversation already tied to a saved job', () => {
    expect(render(result())).not.toContain('반복 업무로 만들기');
  });

  it('shows the request in plain words, without the machine token', () => {
    const value = encodeScheduleInputValue({
      kind: 'recurrence', freq: 'monthly', interval: 1, byMonthDay: [-1], times: [{ hour: 18, minute: 0 }],
      anchor: '2026-10-01', timezone: 'Asia/Seoul',
    });
    const markup = renderToStaticMarkup(<UserMessage message={{ role: 'user', content: `이 작업을 반복 업무로 만들기: ${value}` }} />);
    expect(markup).toContain('이 작업을 반복 업무로 만들기: 매월 마지막 날 오후 6:00');
    expect(markup).not.toContain('⟦');
  });
});
