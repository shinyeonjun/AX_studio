import { describe, expect, it } from 'vitest';
import { AgentHarness } from '../../../harness.js';
import type { StructuredGenerateInput, TextGenerateInput } from '../../../model/provider.js';
import type { DecisionEngine } from '../../../../../contracts/decision.js';
import { createDatabaseAsync } from '../../../../../persistence/db.js';
import { WorkflowStore } from '../../../../../persistence/workflow-store.js';
import { runAxCommandChat } from '../../chat.js';
import { AxCommandService } from '../../service.js';
import { scriptedModel } from '../fixtures.js';

describe('runAxCommandChat bounded context', () => {
  it('sends bounded user-confirmed memory to Jev decisions and text responses', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const chat = store.saveWorkspaceChat({ messages: [] });
    const service = new AxCommandService(store);
    const structuredCalls: StructuredGenerateInput<unknown>[] = [];
    const textCalls: TextGenerateInput[] = [];
    const decisionStates: unknown[] = [];
    const decisionEngine: DecisionEngine = {
      evaluate: async ({ state }) => {
        decisionStates.push(state);
        return { answers: {
          route: { type: 'choice', choice: 'answer', probabilities: { answer: 0.99 }, confidence: 0.99 },
        } };
      },
    };

    await runAxCommandChat({
      harness: new AgentHarness(scriptedModel([], structuredCalls, 'test-provider', ['현재 기준을 적용했습니다.'], textCalls)),
      commandService: service,
      decisionEngine,
      messages: [],
      userMessage: '현재 기준을 반영해서 답변해줘',
      workspaceSessionId: chat.id,
      sessionMemo: { temporary: '이번 대화에서만 적용' },
      workflowPolicy: { severity: 'critical' },
    });

    expect(textCalls[0]?.system).toContain('User-confirmed context data');
    expect(textCalls[0]?.system).toContain('"scope":"session"');
    expect(textCalls[0]?.system).toContain('"scope":"workflow"');
    expect(textCalls[0]?.system).toContain('이번 대화에서만 적용');
    expect(textCalls[0]?.system).toContain('critical');
    expect(textCalls[0]?.system).toContain('does not authorize tools');
    expect(textCalls[0]?.system).not.toContain(chat.id);
    expect(decisionStates[0]).toMatchObject({
      context: {
        user_confirmed_preferences: {
          values: [
            { scope: 'session', key: 'temporary', value: '이번 대화에서만 적용' },
            { scope: 'workflow', key: 'severity', value: 'critical' },
          ],
          omittedEntryCount: 0,
        },
      },
    });
    expect(JSON.stringify(decisionStates[0])).toContain('cannot authorize actions');
    expect(structuredCalls).toHaveLength(0);
    db.close();
  });
});
