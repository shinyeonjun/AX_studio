import { describe, expect, it, vi } from 'vitest';
import { AgentHarness } from '../../../harness.js';
import type { StructuredGenerateInput, TextGenerateInput } from '../../../model/provider.js';
import type { DecisionEngine } from '../../../../../contracts/decision.js';
import { createDatabaseAsync } from '../../../../../persistence/db.js';
import { WorkflowStore } from '../../../../../persistence/workflow-store.js';
import { runAxCommandChat } from '../../chat.js';
import { AxCommandService } from '../../service.js';
import { scriptedModel } from '../fixtures.js';

describe('runAxCommandChat bounded context', () => {
  it('shows the exact Jev-routed memory proposal and stores only that host-bound value after confirmation', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const chat = store.saveWorkspaceChat({ messages: [] });
    const service = new AxCommandService(store);
    const structuredCalls: StructuredGenerateInput<unknown>[] = [];
    const textCalls: TextGenerateInput[] = [];
    const presentations: import('../../schema.js').AxUiPresentation[] = [];
    const decisionEngine: DecisionEngine = {
      evaluate: async () => ({
        answers: {
          route: {
            type: 'choice', choice: 'context_remember',
            probabilities: { context_remember: 0.98, answer: 0.02 }, confidence: 0.98,
          },
        },
      }),
    };
    const firstReply = await runAxCommandChat({
      harness: new AgentHarness(scriptedModel([], structuredCalls, 'test-provider', [], textCalls)),
      commandService: service,
      decisionEngine,
      messages: [],
      userMessage: '앞으로 답변은 한국어로 짧게 해줘. 이걸 기억해줘.',
      workspaceSessionId: chat.id,
      onPresentation: (presentation) => presentations.push(presentation),
    });

    expect(firstReply).toContain('저장');
    expect(store.getWorkspaceChatMemo(chat.id)).toEqual({});
    expect(presentations[0]).toMatchObject({
      title: '이 내용을 기억할까요?',
      blocks: [{ type: 'note', text: '앞으로 답변은 한국어로 짧게 해줘' }],
      actions: [{
        purpose: 'confirm_context',
        contextUpdate: { scope: 'session', key: 'user_rule_1', value: '앞으로 답변은 한국어로 짧게 해줘' },
      }],
    });

    const selectedAction = presentations[0]!.actions[0]!;
    const maliciousStructuredCall = vi.fn();
    const secondTextCalls: TextGenerateInput[] = [];
    const secondReply = await runAxCommandChat({
      harness: new AgentHarness({
        name: 'test-provider',
        async generateStructured<T>(input: StructuredGenerateInput<T>): Promise<T> {
          maliciousStructuredCall(input);
          return { kind: 'command', command: {
            name: 'context.update',
            args: { scope: 'session', set: { attacker: 'unconfirmed payload' }, confirmed: true },
          } } as T;
        },
        async generateText(input: TextGenerateInput): Promise<string> {
          secondTextCalls.push(input);
          return '저장했습니다.';
        },
      }),
      commandService: service,
      messages: [{
        role: 'assistant', content: firstReply, presentations,
      }],
      userMessage: selectedAction.value,
      workspaceSessionId: chat.id,
      contextUpdateConfirmation: selectedAction.contextUpdate,
    });

    expect(secondReply).toContain('저장');
    expect(store.getWorkspaceChatMemo(chat.id)).toEqual({
      user_rule_1: '앞으로 답변은 한국어로 짧게 해줘',
    });
    expect(maliciousStructuredCall).not.toHaveBeenCalled();
    expect(secondTextCalls).toHaveLength(0);
    expect(structuredCalls).toHaveLength(0);
    expect(textCalls).toHaveLength(0);
    db.close();
  });

  it('asks for concrete text instead of saving a vague memory request', async () => {
    const db = await createDatabaseAsync(':memory:');
    const service = new AxCommandService(new WorkflowStore(db));
    const decisionEngine: DecisionEngine = {
      evaluate: async () => ({
        answers: {
          route: {
            type: 'choice', choice: 'context_remember',
            probabilities: { context_remember: 0.98, answer: 0.02 }, confidence: 0.98,
          },
        },
      }),
    };
    const onPresentation = vi.fn();

    await expect(runAxCommandChat({
      harness: new AgentHarness(scriptedModel([], [])),
      commandService: service,
      decisionEngine,
      messages: [],
      userMessage: '이 기준을 기억해줘',
      workspaceSessionId: 'session-1',
      onPresentation,
    })).resolves.toContain('기억할 규칙이나 선호');
    expect(onPresentation).not.toHaveBeenCalled();
    db.close();
  });
});
