import { describe, expect, it } from 'vitest';
import { displayForTrigger, displayForWorkflowNode } from './visual-display.js';

describe('visual-display', () => {
  it('uses node goal for AI summary instead of keyword heuristics', () => {
    const display = displayForWorkflowNode({
      type: 'ai_decision',
      id: 'summarize',
      goal: 'PDF 보고서를 3줄로 요약한다',
      investigation: false,
    });
    expect(display.card.summary).toBe('PDF 보고서를 3줄로 요약한다');
    expect(display.card.summary).not.toBe('메일 내용 요약');
  });

  it('uses capability label and params for action nodes', () => {
    const display = displayForWorkflowNode({
      type: 'action',
      id: 'notify',
      connector: 'slack',
      action: 'message.send',
      params: { channel: '#docs' },
    });
    expect(display.label).toBe('Slack 메시지');
    expect(display.card.summary).toBe('#docs');
    expect(display.iconConnector).toBe('slack');
  });

  it('derives trigger summary from capability params', () => {
    const display = displayForTrigger({
      name: '폴더 감시',
      goal: 'PDF 요약',
      triggerType: 'local_folder.new_file',
      localFolderId: 'folder-inbox',
      localFolderExtensions: '.pdf',
      assumptions: [],
      nodes: [],
    });
    expect(display.card.summary).toBe('folder-inbox');
    expect(display.lines.some((line) => line.text.includes('folder-inbox'))).toBe(true);
    expect(display.iconConnector).toBe('local_folder');
  });

  it('uses workflow goal for manual trigger summary', () => {
    const display = displayForTrigger({
      name: 'PDF 요약',
      goal: '연결된 폴더 PDF 요약',
      triggerType: 'manual',
      assumptions: [],
      nodes: [],
    });
    expect(display.card.summary).toBe('연결된 폴더 PDF 요약');
  });
});
