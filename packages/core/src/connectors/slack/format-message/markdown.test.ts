import { describe, expect, it } from 'vitest';
import { markdownToSlackMrkdwn, parseMarkdownSections } from './markdown.js';

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

describe('text that looks like Slack markup', () => {
  it('is sent as text: no mention, broadcast or link is created from data', async () => {
    const { markdownToSlackMrkdwn } = await import('./markdown.js');
    const out = markdownToSlackMrkdwn('주문자: <!channel> <@U123> 재고 a<b>c & <http://x|클릭>');
    expect(out).toBe('주문자: &lt;!channel&gt; &lt;@U123&gt; 재고 a&lt;b&gt;c &amp; &lt;http://x|클릭&gt;');
    expect(markdownToSlackMrkdwn('**합계** 1,000')).toBe('*합계* 1,000');
  });
});
