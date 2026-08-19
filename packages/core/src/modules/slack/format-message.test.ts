import { describe, expect, it } from 'vitest';
import {
  buildSlackBlocks,
  composeSlackMessage,
  composeSlackMessagePayload,
  formatSlackSourceLine,
  markdownToSlackMrkdwn,
  parseMarkdownSections,
  resolveSlackMessageSource,
} from './format-message.js';

const ctx = {
  executionId: 'run-1',
  variables: {
    fileName: '테스트.pdf',
    folderLabel: 'Inbox',
    axDocumentSummary: { engine: 'basic' },
  },
  log: () => {},
};

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

describe('buildSlackBlocks', () => {
  it('creates header and section blocks for titled sections', () => {
    const blocks = buildSlackBlocks([
      { title: '개요', body: '**요약**입니다.' },
      { title: '세부', body: '• 항목 1' },
    ]);

    expect(blocks).toEqual([
      {
        type: 'header',
        text: { type: 'plain_text', text: '개요', emoji: true },
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: '*요약*입니다.' },
      },
      {
        type: 'header',
        text: { type: 'plain_text', text: '세부', emoji: true },
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: '• 항목 1' },
      },
    ]);
  });

  it('returns undefined when no headings are present', () => {
    expect(buildSlackBlocks([{ body: 'plain text only' }])).toBeUndefined();
  });
});

describe('composeSlackMessage', () => {
  it('appends source footer from execution variables', () => {
    const text = composeSlackMessage('**요약**입니다.', ctx);

    expect(text).toContain('*요약*입니다.');
    expect(text).toContain('_출처 · 테스트.pdf · Inbox · basic_');
  });

  it('uses fileRef when trigger variables are normalized', () => {
    const source = resolveSlackMessageSource({
      executionId: 'run-1',
      variables: {
        fileRef: { name: 'sample.pdf', folderId: 'folder-1', path: 'C:\\docs\\sample.pdf' },
      },
      log: () => {},
    });

    expect(formatSlackSourceLine(source)).toBe('_출처 · sample.pdf · folder-1_');
  });
});

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
