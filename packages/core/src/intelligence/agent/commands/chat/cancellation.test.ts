import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentHarness } from '../../harness.js';
import { createDatabaseAsync } from '../../../../persistence/db.js';
import { WorkflowStore } from '../../../../persistence/workflow-store.js';
import { runAxCommandChat } from '../chat.js';
import { AxCommandService } from '../service.js';
import { scriptedModel } from './fixtures.js';
import type { ConnectorContext } from '../../../../connectors/types.js';
import { buildDesignToolContext } from '../../../design-tools/context.js';

afterEach(() => vi.useRealTimers());

describe('command chat cancellation boundaries', () => {
  it.each(['command', 'reply'] as const)('rejects a late provider %s after timeout without enqueueing', async (kind) => {
    const db = await createDatabaseAsync(':memory:');
    const service = new AxCommandService(new WorkflowStore(db));
    const execute = vi.spyOn(service, 'execute');
    const harness = new AgentHarness(scriptedModel([], []));
    vi.useFakeTimers();
    vi.spyOn(harness, 'run').mockImplementation(async () => {
      await vi.advanceTimersByTimeAsync(11);
      return { role: 'command', output: kind === 'reply'
        ? { kind: 'reply', message: 'late success' }
        : { kind: 'command', command: { name: 'execution.enqueue_once', args: {} } }, toolTrace: [] };
    });
    await expect(runAxCommandChat({
      harness, commandService: service, messages: [], userMessage: 'run once', timeoutMs: 10,
    })).rejects.toThrow('제한 시간을 초과');
    expect(execute).not.toHaveBeenCalled();
    db.close();
  });

  it('passes cancellation to command execution and never publishes a late result', async () => {
    const db = await createDatabaseAsync(':memory:');
    const service = new AxCommandService(new WorkflowStore(db));
    const harness = new AgentHarness(scriptedModel([
      { kind: 'command', command: { name: 'capability.invoke', args: { id: 'http.request' } } },
    ], []));
    const controller = new AbortController();
    const onCommandResult = vi.fn();
    const execute = vi.spyOn(service, 'execute').mockImplementation(async () => {
      controller.abort();
      return { command: 'capability.invoke', status: 'ok', data: { body: 'late result' }, issues: [], inputRequests: [] };
    });
    await expect(runAxCommandChat({
      harness, commandService: service, messages: [], userMessage: 'read', abortSignal: controller.signal,
      onCommandResult,
    })).rejects.toThrow('요청이 취소되었습니다.');
    expect(onCommandResult).not.toHaveBeenCalled();
    expect(execute.mock.calls[0]?.[1]).toMatchObject({ abortSignal: expect.any(AbortSignal) });
    db.close();
  });

  it.each(['context', 'factory'] as const)('forwards abort through the real service and %s into the connector', async (source) => {
    const db = await createDatabaseAsync(':memory:');
    try {
      const service = new AxCommandService(new WorkflowStore(db));
      const harness = new AgentHarness(scriptedModel([
        { kind: 'command', command: { name: 'capability.invoke', args: { id: 'http.request' } } },
      ], []));
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
        harness, commandService: service, messages: [], userMessage: 'read', abortSignal: controller.signal,
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
