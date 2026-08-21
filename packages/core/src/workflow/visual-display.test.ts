import { describe, expect, it } from 'vitest';
import { displayForTrigger, displayForWorkflowNode } from './visual-display.js';
import type { InterviewDraft } from '../interview/draft/schema.js';

const baseDraft = (nodes: InterviewDraft['nodes'], actions: InterviewDraft['actions'] = {}): InterviewDraft => ({
  name: '테스트',
  goal: '테스트',
  assumptions: [],
  nodes,
  actions,
});

describe('visual-display', () => {
  it('uses node goal for AI summary instead of keyword heuristics', () => {
    const draft = baseDraft([
      {
        type: 'ai_decision',
        id: 'summarize',
        goal: 'PDF 보고서를 3줄로 요약한다',
        investigation: false,
      },
    ]);
    const display = displayForWorkflowNode(draft, draft.nodes[0]!);
    expect(display.card.summary).toBe('PDF 보고서를 3줄로 요약한다');
    expect(display.card.summary).not.toBe('메일 내용 요약');
  });

  it('uses capability label and params for action nodes', () => {
    const draft = baseDraft(
      [{ type: 'action', id: 'notify', actionRef: 'slack.message.send@1' }],
      { notify: { actionRef: 'slack.message.send@1', params: { channel: '#docs' } } },
    );
    const display = displayForWorkflowNode(draft, draft.nodes[0]!);
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
      actions: {},
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
      actions: {},
    });
    expect(display.card.summary).toBe('연결된 폴더 PDF 요약');
  });

  it('shows a generic event filter on the trigger', () => {
    const display = displayForTrigger({
      name: '조건부 알림',
      goal: '알림',
      triggerType: 'gmail.new_message',
      gmailAccount: 'primary',
      triggerFilter: {
        op: 'eq',
        left: { ref: 'from' },
        right: { lit: 'sender@example.com' },
      },
      assumptions: [],
      nodes: [],
      actions: {},
    });
    expect(display.lines.some((line) => line.text.includes('from'))).toBe(true);
  });
});
