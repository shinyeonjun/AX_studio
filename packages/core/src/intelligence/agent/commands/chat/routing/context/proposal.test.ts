import { describe, expect, it } from 'vitest';
import { contextProposalCommand } from './proposal.js';

describe('context memory proposal', () => {
  it('asks for concrete text when the request only names a vague reference', () => {
    expect(contextProposalCommand({
      userMessage: '이 기준을 기억해줘',
      hasWorkspaceSession: true,
    })).toMatchObject({
      kind: 'clarify',
      route: 'context_remember',
    });
  });

  it('offers the same exact value for each available save scope without writing it', () => {
    expect(contextProposalCommand({
      userMessage: '앞으로 답변은 한국어로 짧게 해줘. 이걸 기억해줘.',
      hasWorkspaceSession: true,
      sessionMemo: { user_rule_1: '기존 규칙' },
      currentWorkflowId: 'workflow-1',
      workflowPolicy: {},
    })).toMatchObject({
      name: 'ui.present',
      args: {
        blocks: [{ type: 'note', text: '앞으로 답변은 한국어로 짧게 해줘' }],
        actions: [
          { contextUpdate: { scope: 'session', key: 'user_rule_2', value: '앞으로 답변은 한국어로 짧게 해줘' } },
          { contextUpdate: { scope: 'workflow', key: 'user_rule_1', value: '앞으로 답변은 한국어로 짧게 해줘', workflowId: 'workflow-1' } },
        ],
      },
    });
  });

  it('does not offer a save action when the context map already has 64 entries', () => {
    const fullMemo = Object.fromEntries(
      Array.from({ length: 64 }, (_, index) => [`setting_${index}`, 'existing']),
    );

    expect(contextProposalCommand({
      userMessage: '앞으로 답변은 짧게 해줘. 이걸 기억해줘.',
      hasWorkspaceSession: true,
      sessionMemo: fullMemo,
    })).toMatchObject({ kind: 'clarify', route: 'context_remember' });
  });
});
