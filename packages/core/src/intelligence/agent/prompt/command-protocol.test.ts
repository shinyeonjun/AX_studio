import { describe, expect, it } from 'vitest';
import { buildCommandProtocolPrompt } from './command-protocol.js';
import { compactModelMessages } from '../commands/chat/protocol.js';
import { buildInvestigatePrompt } from './investigate-prompt.js';

describe('role prompts', () => {
  it('bounds the attached-source manifest and excludes internal and page-level metadata', () => {
    const prompt = buildCommandProtocolPrompt({ commands: [], outputInstructions: 'reply',
      workspaceSources: Array.from({ length: 500 }, (_, i) => ({
        id: `source-${i}`, fileName: `reference-${i}.pdf`, status: 'ready',
        artifactId: 'internal-artifact', sessionId: 'internal-session',
        summary: { pageCount: 900, visualPages: Array.from({ length: 900 }, (_, p) => p) },
      })),
    });
    expect(prompt.length).toBeLessThan(22_000);
    expect(prompt).not.toContain('internal-artifact');
    expect(prompt).not.toContain('visualPages');
    expect(prompt).toContain('nextOffset');
    expect(prompt).toContain('source-0');
  });

  it('keeps the command protocol independent of connector skills', () => {
    const prompt = buildCommandProtocolPrompt({
      connectedConnectors: ['gmail', 'slack', 'unknown'],
      commands: [{ name: 'workflow.list' }],
      outputInstructions: 'reply or command',
    });

    expect(prompt).toContain('AX command protocol');
    expect(prompt).toContain('기본 연결을 임의로 고르지 않는다');
    expect(prompt).toContain('그 결과의 id·label만 사용해 `ui.present` 선택 카드를 만들고');
    expect(prompt).not.toContain('# Gmail');
    expect(prompt).not.toContain('# Slack');
    expect(prompt).not.toContain('tools.list');
  });

  it('uses catalog read capabilities for investigation', () => {
    const prompt = buildInvestigatePrompt('investigate', {
      skillGoal: '문서 요약',
      taskGoal: '문서 evidence를 요약',
      evidence: [],
      connectedConnectors: ['document'],
    });

    expect(prompt).toContain('document.ingest');
  });

  it('bounds provider history while retaining the newest message', () => {
    const messages = [
      { role: 'user' as const, content: 'old'.repeat(30_000) },
      { role: 'user' as const, content: 'new request' },
    ];
    const compacted = compactModelMessages(messages, 'new request');

    expect(compacted.at(-1)?.content).toBe('new request');
    expect(compacted.reduce((sum, message) => sum + message.content.length, 0)).toBeLessThanOrEqual(64_000);
    expect(compacted.length - 1).toBeLessThanOrEqual(60);
    expect(compacted[0]?.content).toContain('모델 입력 한도');
  });

  it('retains the current request after command results are appended', () => {
    const currentRequest = '이번 분기 매출 보고서를 생성해줘';
    const messages = [
      { role: 'user' as const, content: currentRequest },
      ...Array.from({ length: 70 }, (_, index) => ({
        role: index % 2 ? 'user' as const : 'assistant' as const,
        content: `command result ${index} ${'x'.repeat(2_000)}`,
      })),
    ];

    const compacted = compactModelMessages(messages, currentRequest);

    expect(compacted.some((message) => message.content === currentRequest)).toBe(true);
    expect(compacted.reduce((sum, message) => sum + message.content.length, 0)).toBeLessThanOrEqual(64_000);
    expect(compacted.at(-1)?.content).toContain('command result 69');
  });

  it('fails closed when the required request is absent', () => {
    expect(() => compactModelMessages(
      Array.from({ length: 61 }, () => ({ role: 'assistant' as const, content: '결과' })),
      '현재 요청',
    )).toThrow('current user message');
  });
});
