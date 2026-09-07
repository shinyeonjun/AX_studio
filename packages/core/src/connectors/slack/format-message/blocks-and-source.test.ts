import { describe, expect, it } from 'vitest';
import {
  buildSlackBlocks,
  composeSlackMessage,
  formatSlackSourceLine,
  resolveSlackMessageSource,
} from '../format-message.js';

const ctx = {
  executionId: 'run-1',
  variables: {
    fileName: '테스트.pdf',
    folderLabel: 'Inbox',
    axDocumentSummary: { engine: 'basic' },
  },
  log: () => {},
};

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
