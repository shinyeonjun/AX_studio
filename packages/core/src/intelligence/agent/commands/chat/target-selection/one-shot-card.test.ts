import { describe, expect, it } from 'vitest';
import { AgentHarness } from '../../../harness.js';
import type { StructuredGenerateInput, TextGenerateInput } from '../../../model/provider.js';
import { createDatabaseAsync } from '../../../../../persistence/db.js';
import { WorkflowStore } from '../../../../../persistence/workflow-store.js';
import { runAxCommandChat } from '../../chat.js';
import { AxCommandService } from '../../service.js';
import { scriptedModel } from '../fixtures.js';
import type { DecisionEngine } from '../../../../../contracts/decision.js';

describe('runAxCommandChat target selection', () => {
  it('publishes a Slack target card without asking the LLM to build the one-shot action', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    store.setConnection('slack', true);
    const chat = store.saveWorkspaceChat({ messages: [] });
    let enqueueCalls = 0;
    const service = new AxCommandService(store, {
      enqueueOnce: () => { enqueueCalls += 1; return { jobId: 'job-1' }; },
      readGateway: {
        execute: async () => ({
          tool: 'capabilities.invoke',
          ok: true,
          data: { data: { channels: [{ id: 'C_OPERATIONS', name: '운영' }] } },
        }),
      },
    });
    const presentations: import('../../schema.js').AxUiPresentation[] = [];
    const seen: StructuredGenerateInput<unknown>[] = [];
    const textSeen: TextGenerateInput[] = [];
    const decisionEngine: DecisionEngine = {
      evaluate: async (request) => {
        const action = request.questions.action;
        const selectedAction = action?.type === 'choice'
          ? Object.entries(action.criteria).find(([, criterion]) =>
            typeof criterion === 'string' && criterion.startsWith('slack.message.send —'))
          : undefined;
        return {
          answers: {
            route: {
              type: 'choice', choice: 'execution_enqueue_once',
              probabilities: { execution_enqueue_once: 0.98, answer: 0.02 }, confidence: 0.98,
            },
            explicit_execution_now: { type: 'choice', choice: 'execute_now', probabilities: { execute_now: 0.99 }, confidence: 0.99 },
            action_scope: {
              type: 'choice', choice: 'single_action',
              probabilities: { single_action: 0.98, multi_step: 0.01, unclear: 0.01 }, confidence: 0.98,
            },
            action: {
              type: 'choice', choice: selectedAction?.[0] ?? 'none',
              probabilities: { [selectedAction?.[0] ?? 'none']: 0.99, none: selectedAction ? 0.01 : 0.99 },
              confidence: 0.99,
            },
          },
        };
      },
    };

    const reply = await runAxCommandChat({
      harness: new AgentHarness(scriptedModel([], seen, 'test-provider', [], textSeen)),
      commandService: service,
      decisionEngine,
      messages: [],
      userMessage: '이번만 Slack에 "테스트 메시지"를 보내줘. 반복 업무로 저장하지 마.',
      connectedConnectors: ['slack'],
      workspaceSessionId: chat.id,
      designToolContext: { connections: [], connectedConnectorIds: ['slack'], connectors: {} },
      onPresentation: (presentation) => presentations.push(presentation),
    });

    expect(reply).toContain('연결과 채널');
    expect(enqueueCalls).toBe(0);
    expect(seen).toHaveLength(0);
    expect(textSeen).toHaveLength(0);
    expect(presentations).toHaveLength(1);
    expect(presentations[0]).toMatchObject({
      title: '공유 대상 선택',
      inputMode: 'batch',
      inputs: [
        {
          id: 'execution-action_1-slack-channel',
          stepId: 'action_1', capabilityId: 'slack.message.send', parameterName: 'channel',
          options: [{ value: 'C_OPERATIONS', label: '#운영' }],
        },
      ],
      actions: [{ id: 'review_execution_targets', label: '선택하고 실행안 검토' }],
    });
    db.close();
  });
});
