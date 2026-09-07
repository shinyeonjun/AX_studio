import { describe, expect, it } from 'vitest';
import { markdownToSlackMrkdwn, parseMarkdownSections } from '../format-message.js';

describe('markdownToSlackMrkdwn', () => {
  it('converts markdown bold to Slack bold', () => {
    expect(markdownToSlackMrkdwn('**요약**\n\n본문')).toBe('*요약*\n\n본문');
  });

  it('converts markdown headings to Slack bold lines', () => {
    expect(markdownToSlackMrkdwn('## 개요\n내용')).toBe('*개요*\n내용');
  });
});

describe('parseMarkdownSections', () => {
  it('splits markdown on headings', () => {
    expect(
      parseMarkdownSections('## 개요\n첫 단락\n\n## 핵심\n두 번째'),
    ).toEqual([
      { title: '개요', body: '첫 단락' },
      { title: '핵심', body: '두 번째' },
    ]);
  });

  it('keeps preamble before the first heading', () => {
    expect(parseMarkdownSections('서문\n\n## 본문\n내용')).toEqual([
      { body: '서문' },
      { title: '본문', body: '내용' },
    ]);
  });
});
