import { describe, expect, it } from 'vitest';
import { AgentHarness } from '../../../harness.js';
import type { StructuredGenerateInput } from '../../../model/provider.js';
import { createDatabaseAsync } from '../../../../store/db.js';
import { WorkflowStore } from '../../../../store/workflow-store.js';
import { runAxCommandChat } from '../../chat.js';
import { AxCommandService } from '../../service.js';
import { scriptedModel } from '../fixtures.js';

describe('runAxCommandChat bounded context', () => {
  it('persists context only after a host-confirmed presentation action', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const chat = store.saveWorkspaceChat({ messages: [] });
    const service = new AxCommandService(store);
    const firstSeen: StructuredGenerateInput<unknown>[] = [];
    const firstHarness = new AgentHarness(
      scriptedModel([
        {
          kind: 'command',
          command: {
            name: 'ui.present',
            args: {
              title: '이 기준을 기억할까요?',
              actions: [{ id: 'remember', label: '기억하기', value: '이 기준을 기억해줘', purpose: 'confirm_context' }],
            },
          },
        },
        { kind: 'reply', message: '확인 후 저장할 수 있습니다.' },
      ], firstSeen),
    );
    const presentations: import('../../schema.js').AxUiPresentation[] = [];

    await runAxCommandChat({
      harness: firstHarness,
      commandService: service,
      messages: [],
      userMessage: '이 기준을 기억해줘',
      workspaceSessionId: chat.id,
      onPresentation: (presentation) => presentations.push(presentation),
    });

    expect(store.getWorkspaceChatMemo(chat.id)).toEqual({});
    expect(presentations[0]?.actions[0]?.purpose).toBe('confirm_context');

    const secondSeen: StructuredGenerateInput<unknown>[] = [];
    const secondHarness = new AgentHarness(
      scriptedModel([
        {
          kind: 'command',
          command: {
            name: 'context.update',
            args: { scope: 'session', set: { criterion: '예산 초과' }, confirmed: true },
          },
        },
        { kind: 'reply', message: '이번 세션 기준으로 저장했습니다.' },
      ], secondSeen),
    );

    const reply = await runAxCommandChat({
      harness: secondHarness,
      commandService: service,
      messages: [
        { role: 'assistant', content: '확인해 주세요.', presentations },
      ],
      userMessage: '이 기준을 기억해줘',
      workspaceSessionId: chat.id,
      allowContextUpdate: true,
    });

    expect(reply).toBe('이번 세션 기준으로 저장했습니다.');
    expect(store.getWorkspaceChatMemo(chat.id)).toEqual({ criterion: '예산 초과' });
    expect(secondSeen[1]?.messages?.at(-1)?.content).toContain('context.update');
  });
});
