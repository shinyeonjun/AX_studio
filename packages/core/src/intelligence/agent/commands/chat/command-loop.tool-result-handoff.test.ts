import { describe, expect, it, vi } from 'vitest';
import { AgentHarness } from '../../harness.js';
import type { TextGenerateInput } from '../../model/provider.js';
import { createDatabaseAsync } from '../../../../persistence/db.js';
import { WorkflowStore } from '../../../../persistence/workflow-store.js';
import { WorkflowRuntime } from '../../../../runtime/engine.js';
import { createTestConnectors } from '../../../../testing/connectors/test-connectors.js';
import { runAxCommandChat } from '../chat.js';
import { AxCommandService } from '../service.js';
import { parallelToolAnswersForTest, scriptedModel } from './fixtures.js';
import type { DecisionEngine } from '../../../../contracts/decision.js';

vi.mock('../../../../persistence/paths/app-log.js', () => ({ appendAppLog: vi.fn() }));

// Persisted-session/verified-identity regression adapted from the independent dc95 handoff probe.
describe('command-generated verified tool handoff', () => {
  it('completes the command-generated final send only through verified exact review', async () => {
    const db = await createDatabaseAsync(':memory:');
    try {
      const store = new WorkflowStore(db);
      store.setConnection('gmail', true, { email: 'primary' });
      const session = store.saveWorkspaceChat({ messages: [{ role: 'user', content: 'Synthetic review command' }] });
      const connectors = createTestConnectors();
      const sendCalls: Array<{ params: Record<string, unknown>; literal: boolean }> = [];
      let identityReviews = 0;
      connectors.gmail = {
        name: 'gmail',
        prepareMessageSend: async draft => {
          identityReviews += 1;
          if (draft.tool !== 'gmail') throw new Error('Synthetic provider mismatch');
          return { provider: 'gmail', accountId: 'verified-synthetic@example.test', accountLabel: 'verified-synthetic@example.test',
            destinationId: draft.to, destinationLabel: draft.to };
        },
        execute: async (_action, params, ctx) => {
          sendCalls.push({ params: structuredClone(params), literal: ctx.literalMessage === true });
          return { ok: true, data: { id: 'reviewer-synthetic-command-receipt' } };
        },
      };
      const runtime = new WorkflowRuntime({
        store,
        globalActive: true,
        workflowActive: {},
        connectors,
      });
      const service = new AxCommandService(store, {
        enqueueOnce: (workflow, options) => runtime.enqueueEphemeralWorkflow(workflow, {
          triggerType: 'manual',
          workspaceSessionId: options?.workspaceSessionId,
        }),
      });
      const decisionEngine: DecisionEngine = {
        evaluate: async (request) => {
          return {
            answers: {
              ...parallelToolAnswersForTest(request, {
                needsNaturalLanguageAnswer: false,
                select: (candidate) => candidate.capabilityId === 'gmail.message.send',
              }),
              route: {
                type: 'choice', choice: 'execution_enqueue_once',
                probabilities: { execution_enqueue_once: 0.99, answer: 0.01 }, confidence: 0.99,
              },
              explicit_execution_now: { type: 'choice', choice: 'execute_now', probabilities: { execute_now: 0.99 }, confidence: 0.99 },
            },
          };
        },
      };
      const textSeen: TextGenerateInput[] = [];
      const reply = await runAxCommandChat({
        harness: new AgentHarness(scriptedModel([], [], 'test-provider', [], textSeen)),
        commandService: service,
        decisionEngine,
        connectedConnectors: ['gmail'],
        workspaceSessionId: session.id,
        messages: [],
        userMessage: '이번만 person@example.com에게 메일을 보내줘. 일회성으로 실행해줘. body: "견적서를 보내 주세요"',
      });

      expect(reply).toContain('큐');
      await runtime.waitForIdle();
      const [approval] = store.getPendingApprovals();
      expect(approval).toBeDefined();
      expect(store.listWorkflows()).toHaveLength(0);
      expect(store.getExecution(approval!.executionId)).toMatchObject({
        ephemeral: true,
        status: 'pending_approval',
      });
      expect(sendCalls).toEqual([]);
      expect(textSeen).toHaveLength(0);

      const blocked = await runtime.continueAfterApproval(approval!.id);
      expect(blocked).toMatchObject({ status: 'failed', errorCode: 'tool_result_confirmation_required' });
      expect(store.getApproval(approval!.id)?.status).toBe('pending');
      expect(store.getExecution(approval!.executionId)?.status).toBe('pending_approval');
      expect(sendCalls).toEqual([]);
      expect(identityReviews).toBe(0);
      const source = runtime.getToolResult(approval!.id);
      expect(source).toMatchObject({ workspaceSessionId: session.id, revision: 0,
        draft: { tool: 'gmail', to: 'person@example.com', subject: '', body: '견적서를 보내 주세요' } });
      const reviewed = await runtime.reviewToolResult({ approvalId: approval!.id, workspaceSessionId: session.id, revision: source!.revision });
      expect(reviewed.binding).toMatchObject({ provider: 'gmail', accountId: 'verified-synthetic@example.test', destinationId: 'person@example.com' });
      expect(identityReviews).toBe(1);
      const outcomes = await Promise.all([
        runtime.continueAfterApproval(approval!.id, reviewed.confirmation),
        runtime.continueAfterApproval(approval!.id, reviewed.confirmation),
      ]);
      const successes = outcomes.filter(outcome => outcome.status === 'success');
      expect(successes).toHaveLength(1);
      expect(sendCalls).toEqual([{ params: { to: 'person@example.com', subject: '', body: '견적서를 보내 주세요' }, literal: true }]);
      expect(successes[0]!.toolSendOutcome).toMatchObject({ status: 'sent', receiptId: 'reviewer-synthetic-command-receipt' });
      expect(store.getApproval(approval!.id)?.status).toBe('approved');
      expect(store.getExecution(approval!.executionId)?.status).toBe('success');
      expect(textSeen).toHaveLength(0);
      await runtime.waitForIdle();
    } finally {
      db.close?.();
    }
  });

});
