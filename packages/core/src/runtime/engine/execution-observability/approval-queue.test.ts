import { describe, expect, it, vi } from 'vitest';
import { createDatabaseAsync } from '../../../store/db.js';
import { WorkflowStore } from '../../../store/workflow-store.js';
import { WorkflowRuntime } from '../../engine.js';
import type { WorkflowIR } from '../../../workflow/schema.js';

describe('runtime approval and queue observability', () => {
  it('pauses explicit HTTP POST before the connector can perform network I/O', async () => {
    const execute = vi.fn(async () => ({ ok: true, data: { created: true } }));
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const runtime = new WorkflowRuntime({
      store,
      globalActive: true,
      workflowActive: {},
      connectors: { http: { name: 'http', execute } },
    });

    const result = await runtime.executeWorkflow({
      name: 'HTTP POST 승인',
      goal: '외부 API에 payload를 보낸다',
      version: 1,
      steps: [
        {
          type: 'action',
          id: 'create_ticket',
          connector: 'http',
          action: 'post',
          actionRef: 'http.post@1',
          params: { path: 'tickets', body: { title: '승인 대기' } },
          sideEffect: 'EXTERNAL',
        },
      ],
      permissions: {},
      approval: [],
      allowExternalAuto: false,
      assumptions: [],
      sideEffects: {},
      dataPolicy: {},
    }, { ephemeral: true });

    expect(result.status).toBe('pending_approval');
    expect(result.pendingApprovalId).toBeTruthy();
    expect(execute).not.toHaveBeenCalled();
  });

  it('serializes queued one-shot runs and records each as ephemeral', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const events: string[] = [];
    const runtime = new WorkflowRuntime({
      store,
      globalActive: true,
      workflowActive: {},
      connectors: {},
      onExecutionStarted: (executionId) => events.push(`start:${executionId}`),
      onExecutionFinished: (result) => events.push(`finish:${result.executionId}`),
    });
    const plan: WorkflowIR = {
      id: 'queued-draft',
      name: '큐 일회 실행',
      goal: '한 번씩 순서대로 처리한다',
      version: 1,
      steps: [],
      permissions: {},
      approval: [],
      allowExternalAuto: true,
      assumptions: [],
      sideEffects: {},
      dataPolicy: {},
    };

    const first = runtime.enqueueEphemeralWorkflow(plan);
    const second = runtime.enqueueEphemeralWorkflow(plan);
    await runtime.waitForIdle();

    expect(first.jobId).not.toBe(second.jobId);
    expect(events).toHaveLength(4);
    expect(events[0]?.startsWith('start:')).toBe(true);
    expect(events[1]?.startsWith('finish:')).toBe(true);
    expect(events[2]?.startsWith('start:')).toBe(true);
    expect(events[3]?.startsWith('finish:')).toBe(true);
    expect(store.listWorkflows()).toHaveLength(0);
    expect(store.listExecutions(10)).toHaveLength(2);
    expect(store.listExecutions(10).every((execution) => execution.ephemeral)).toBe(true);
  });
});
