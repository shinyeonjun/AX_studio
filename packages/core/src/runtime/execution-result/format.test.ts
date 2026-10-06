import { describe, expect, it } from 'vitest';
import { formatExecutionResultMessage } from './format.js';

function resultWithPreview(outputPreview: Record<string, unknown>) {
  return {
    executionId: 'exec-1',
    status: 'success' as const,
    log: [{ at: '2026-10-06T00:00:00.000Z', level: 'info' as const, code: 'ai_decision_completed', message: 'done', data: { outputPreview } }],
  };
}

describe('formatExecutionResultMessage', () => {
  it('shows AI confidence as a level and hides internal flags', () => {
    const message = formatExecutionResultMessage(resultWithPreview({ conclusion: '주문 2건', confidence: 1, needMore: false }));
    expect(message).toContain('결론: 주문 2건');
    expect(message).toContain('AI 판단 확신도: 높음');
    expect(message).not.toContain('신뢰도: 1');
    expect(message).not.toContain('false');
  });

  it('explains when more evidence is needed', () => {
    const message = formatExecutionResultMessage(resultWithPreview({ confidence: 0.3, needMore: true }));
    expect(message).toContain('AI 판단 확신도: 낮음');
    expect(message).toContain('더 많은 자료를 확인해야');
  });
});
