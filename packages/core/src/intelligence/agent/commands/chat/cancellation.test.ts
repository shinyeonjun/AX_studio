import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentHarness } from '../../harness.js';
import { createDatabaseAsync } from '../../../../persistence/db.js';
import { WorkflowStore } from '../../../../persistence/workflow-store.js';
import { runAxCommandChat } from '../chat.js';
import { AxCommandService } from '../service.js';
import { scriptedModel } from './fixtures.js';
import type { ConnectorContext } from '../../../../connectors/types.js';
import { buildDesignToolContext } from '../../../design-tools/context.js';
import type { DecisionEngine } from '../../../../contracts/decision.js';

afterEach(() => vi.useRealTimers());

describe('command chat cancellation boundaries', () => {
  it('rejects a late Jev route decision after timeout without executing a command', async () => {
    const db = await createDatabaseAsync(':memory:');
    const service = new AxCommandService(new WorkflowStore(db));
    const execute = vi.spyOn(service, 'execute');
    const harness = new AgentHarness(scriptedModel([], []));
    const decisionEngine: DecisionEngine = {
      evaluate: async () => {
        await new Promise((resolve) => setTimeout(resolve, 11));
        return { answers: {
          route: {
            type: 'choice', choice: 'execution_enqueue_once',
            probabilities: { execution_enqueue_once: 0.99 }, confidence: 0.99,
          },
        } };
      },
    };
    vi.useFakeTimers();
    const pending = runAxCommandChat({
      harness, commandService: service, decisionEngine, messages: [], userMessage: 'run once', timeoutMs: 10,
    });
    const rejected = expect(pending).rejects.toThrow('제한 시간을 초과');
    await vi.advanceTimersByTimeAsync(11);
    await rejected;
    expect(execute).not.toHaveBeenCalled();
    db.close();
  });

  it.each(['context', 'factory'] as const)('forwards abort through the real service and %s into the connector', async (source) => {
    const db = await createDatabaseAsync(':memory:');
    try {
      const service = new AxCommandService(new WorkflowStore(db));
      const harness = new AgentHarness(scriptedModel([], []));
      const decisionEngine: DecisionEngine = {
        evaluate: async () => ({
          answers: {
            route: {
              type: 'choice',
              choice: 'http_read',
              probabilities: { http_read: 0.98, answer: 0.02 },
              confidence: 0.98,
            },
          },
        }),
      };
      const controller = new AbortController();
      const onCommandResult = vi.fn();
      const execute = vi.fn(async (_action: string, _params: Record<string, unknown>, ctx: ConnectorContext) => {
        expect(ctx.abortSignal).toBeInstanceOf(AbortSignal);
        expect(ctx.abortSignal?.aborted).toBe(false);
        controller.abort();
        expect(ctx.abortSignal?.aborted).toBe(true);
        return { ok: true, data: { body: 'late result' } };
      });
      const context = buildDesignToolContext([], ['http'], { allowUntrustedData: true, connectors: { http: { name: 'http', execute } } });
      await expect(runAxCommandChat({
        harness, commandService: service, decisionEngine, connectedConnectors: ['http'],
        httpEndpoints: [{ id: 'test', label: '테스트 HTTP 연결', usable: true }],
        messages: [], userMessage: '테스트 HTTP 연결 GET items', abortSignal: controller.signal,
        onCommandResult,
        ...(source === 'context' ? { designToolContext: context } : { designToolContextFactory: () => context }),
      })).rejects.toThrow('요청이 취소되었습니다.');
      expect(execute).toHaveBeenCalledOnce();
      expect(onCommandResult).not.toHaveBeenCalled();
    } finally {
      db.close();
    }
  });
});
