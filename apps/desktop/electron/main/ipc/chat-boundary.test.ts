import { describe, expect, it } from 'vitest';
import { normalizeChatMessages, selectChatContext } from './chat-boundary.js';

describe('workspace chat boundary', () => {
  it('retains a long transcript while bounding model context and preserving the latest instruction', () => {
    const messages = Array.from({ length: 220 }, (_, index) => ({
      role: index % 2 ? 'assistant' : 'user', content: `message ${index}`,
    }));
    messages.push({ role: 'user', content: '그런데 이번에는 이번 달 기준으로 처리해줘' });
    const stored = normalizeChatMessages(messages);
    const context = selectChatContext(stored);
    expect(stored).toHaveLength(221);
    expect(context.length).toBeLessThanOrEqual(100);
    expect(context.at(-1)).toEqual(messages.at(-1));
    expect(context[0]?.content).toContain('생략');
    expect(stored[0]).toEqual(messages[0]);
  });

  it('bounds the model character budget without dropping the current user request', () => {
    const stored = normalizeChatMessages([
      ...Array.from({ length: 10 }, () => ({ role: 'assistant', content: 'x'.repeat(50_000) })),
      { role: 'user', content: '지난번 기준이 기억 안 나면 먼저 물어봐' },
    ]);
    const context = selectChatContext(stored);
    expect(context.reduce((total, message) => total + message.content.length, 0)).toBeLessThanOrEqual(250_000);
    expect(context.at(-1)).toEqual(stored.at(-1));
    expect(stored).toHaveLength(11);
    expect(() => normalizeChatMessages([{ role: 'user', content: 'x'.repeat(50_001) }])).toThrow();
  });
  it('does not accept execution status on an ordinary assistant message', () => {
    expect(() => normalizeChatMessages([
      { role: 'assistant', content: '일반 답변', executionStatus: 'success' },
    ])).toThrow();
  });

  it('preserves typed status on an execution result message', () => {
    expect(normalizeChatMessages([
      {
        role: 'assistant',
        content: '실행 결과',
        kind: 'execution_result',
        executionId: 'exec-1',
        executionStatus: 'success',
      },
    ])).toEqual([
      {
        role: 'assistant',
        content: '실행 결과',
        kind: 'execution_result',
        executionId: 'exec-1',
        executionStatus: 'success',
      },
    ]);
  });

  it('preserves bounded inline approval metadata only on an execution result', () => {
    const approval = {
      id: 'approval-1',
      title: '결제 요약 — Slack 메시지 전송',
      reason: '외부 작업 승인 필요: slack.message.send@1',
    };
    expect(normalizeChatMessages([
      {
        role: 'assistant',
        content: '승인 대기 중입니다.',
        kind: 'execution_result',
        executionId: 'exec-1',
        executionStatus: 'pending_approval',
        approval,
      },
    ])).toEqual([{
      role: 'assistant',
      content: '승인 대기 중입니다.',
      kind: 'execution_result',
      executionId: 'exec-1',
      executionStatus: 'pending_approval',
      approval,
    }]);
    expect(() => normalizeChatMessages([
      { role: 'assistant', content: '일반 답변', approval },
    ])).toThrow();
  });

  it('preserves safe generated PDF metadata and rejects paths or ordinary assistant messages', () => {
    const generatedPdf = {
      artifactId: 'art_pdf_1',
      fileName: '2026-09_customer_report.pdf',
      size: 12_345,
      mimeType: 'application/pdf',
    } as const;
    expect(normalizeChatMessages([{
      role: 'assistant',
      content: '보고서를 생성했습니다.',
      kind: 'execution_result',
      executionId: 'exec-1',
      executionStatus: 'success',
      generatedPdf,
    }])).toEqual([{
      role: 'assistant',
      content: '보고서를 생성했습니다.',
      kind: 'execution_result',
      executionId: 'exec-1',
      executionStatus: 'success',
      generatedPdf,
    }]);
    expect(() => normalizeChatMessages([{
      role: 'assistant',
      content: '일반 답변',
      generatedPdf,
    }])).toThrow();
    expect(() => normalizeChatMessages([{
      role: 'assistant',
      content: '보고서',
      kind: 'execution_result',
      executionId: 'exec-1',
      generatedPdf: { ...generatedPdf, fileName: 'C:\\private\\report.pdf' },
    }])).toThrow();
  });
});
