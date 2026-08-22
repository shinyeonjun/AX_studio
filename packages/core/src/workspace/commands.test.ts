import { describe, expect, it } from 'vitest';
import { parseWorkspaceCommand } from './commands.js';

describe('parseWorkspaceCommand', () => {
  it('parses /once with instruction', () => {
    expect(parseWorkspaceCommand('/once PDF 분석해서 Slack 알림')).toEqual({
      mode: 'once',
      instruction: 'PDF 분석해서 Slack 알림',
    });
  });

  it('parses /workflow with instruction', () => {
    expect(parseWorkspaceCommand('/workflow 새 PDF 들어오면 분류')).toEqual({
      mode: 'workflow',
      instruction: '새 PDF 들어오면 분류',
    });
  });

  it('treats plain text as chat', () => {
    expect(parseWorkspaceCommand('폴더에 PDF 뭐 있어?')).toEqual({
      mode: 'chat',
      text: '폴더에 PDF 뭐 있어?',
    });
  });

  it('flags empty slash commands', () => {
    expect(parseWorkspaceCommand('/once')).toEqual({ mode: 'once', instruction: '' });
    expect(parseWorkspaceCommand('/workflow')).toEqual({ mode: 'workflow', instruction: '' });
  });
});
