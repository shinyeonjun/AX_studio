import { describe, expect, it } from 'vitest';
import { composeSlackMessagePayload } from '../format-message.js';

const ctx = {
  executionId: 'run-1',
  variables: {
    fileName: '테스트.pdf',
    folderLabel: 'Inbox',
    axDocumentSummary: { engine: 'basic' },
  },
  log: () => {},
};

describe('composeSlackMessagePayload', () => {
  it('returns Block Kit blocks for multi-section markdown', () => {
    const payload = composeSlackMessagePayload(
      '## 개요\n첫 내용\n\n## 결론\n마무리',
      ctx,
    );

    expect(payload.blocks).toEqual([
      {
        type: 'header',
        text: { type: 'plain_text', text: '개요', emoji: true },
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: '첫 내용' },
      },
      {
        type: 'header',
        text: { type: 'plain_text', text: '결론', emoji: true },
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: '마무리' },
      },
      {
        type: 'context',
        elements: [{ type: 'mrkdwn', text: '_출처 · 테스트.pdf · Inbox · basic_' }],
      },
    ]);
    expect(payload.text).toContain('*개요*');
    expect(payload.text).toContain('_출처 · 테스트.pdf · Inbox · basic_');
  });

  it('falls back to plain text when headings are absent', () => {
    const payload = composeSlackMessagePayload('**요약**입니다.', ctx);

    expect(payload.blocks).toBeUndefined();
    expect(payload.text).toContain('*요약*입니다.');
    expect(payload.text).toContain('_출처 · 테스트.pdf · Inbox · basic_');
  });
});
