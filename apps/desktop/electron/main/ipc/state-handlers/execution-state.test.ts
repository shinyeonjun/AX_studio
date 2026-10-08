import { describe, expect, it, vi } from 'vitest';
import type { AxCore } from '../../core-instance.js';
import { buildExecutions, buildPendingApprovals } from './execution-state.js';

describe('buildPendingApprovals', () => {
  it('uses the batched execution snapshot instead of reading each execution', () => {
    const getPendingApprovalsWithExecutionSnapshots = vi.fn(() => [{
      approval: {
        id: 'approval-1', executionId: 'execution-1', actionIds: ['notify'],
        reason: 'Review before sending', status: 'pending', createdAt: '2026-09-25T10:00:00Z',
        resolvedAt: null, payload: undefined,
      },
      executionIrJson: undefined,
    }]);
    const getExecution = vi.fn(() => { throw new Error('per-approval reads are not expected'); });
    const core = {
      store: { getPendingApprovalsWithExecutionSnapshots, getExecution },
    } as unknown as AxCore;

    expect(buildPendingApprovals(core)).toMatchObject([{
      id: 'approval-1', errorCode: 'invalid_execution_snapshot',
    }]);
    expect(getPendingApprovalsWithExecutionSnapshots).toHaveBeenCalledOnce();
    expect(getExecution).not.toHaveBeenCalled();
  });
});

describe('historical execution state projection', () => {
  it.each(['invalid_execution_snapshot', 'invalid_execution_log'])('does not describe %s as terminal before failure', errorCode => {
    const core = { store: { listExecutions: () => [{ id: 'synthetic', status: 'running', errorCode,
      hasOutput: false, historyDiagnostics: [],
      logJson: JSON.stringify([{ at: '2026-09-01T00:00:00Z', level: 'error', code: 'old_failure', message: 'Older synthetic error' }]),
    }] } } as unknown as AxCore;
    expect(buildExecutions(core)[0]).toMatchObject({ status: 'running', errorMessage: '작업을 완료하지 못했어요. 연결 상태를 확인한 뒤 다시 시도해 주세요.' });
  });

  it('keeps result bodies out of app state and derives pending progress from the restored tail', () => {
    const listExecutions = vi.fn(() => [{ id: 'synthetic-pending', workflowId: null, ephemeral: true,
      status: 'pending_approval', errorCode: 'pending_approval', hasOutput: false, historyDiagnostics: [],
      logJson: JSON.stringify([{ at: '2026-09-01T00:00:00Z', level: 'warn', code: 'waiting_approval',
        message: 'Synthetic approval pending', data: { stepId: 'send' } }]),
    }, { id: 'synthetic-completed', workflowId: null, ephemeral: true, status: 'success', errorCode: null,
      hasOutput: true, historyDiagnostics: [], logJson: '[]', output: { version: 1, fields: [{ path: 'large', valueJson: '42' }] },
    }]);
    const core = { store: { listExecutions } } as unknown as AxCore;
    const state = buildExecutions(core);
    expect(listExecutions).toHaveBeenCalledExactlyOnceWith(50, false);
    expect(state[0]).toMatchObject({ status: 'pending_approval', technicalStatus: 'waiting_approval',
      currentStepId: 'send', currentStepStatus: 'waiting_approval', hasOutput: false });
    expect(state[1]).toMatchObject({ hasOutput: true });
    expect(state[1]).not.toHaveProperty('output');
  });

  it('surfaces raw-history diagnostics without presenting corrupt entries as normal progress', () => {
    const historyDiagnostics = [{ code: 'invalid_log_entry', source: 'log_tail', sequence: 12 }];
    const core = { store: { listExecutions: () => [{ id: 'synthetic', status: 'running', errorCode: null,
      hasOutput: false, historyDiagnostics,
      logJson: JSON.stringify([{ level: 'info', code: 'step_completed', message: 'Untrusted shape', data: { stepId: 'fake' } }]),
    }] } } as unknown as AxCore;
    expect(buildExecutions(core)[0]).toMatchObject({ historyDiagnostics, currentStepId: undefined, currentStepStatus: undefined });
  });
});

describe('repeated state refreshes', () => {
  it('follows a growing log of the same execution instead of reusing a stale summary', () => {
    let logJson = JSON.stringify([{ at: '2026-09-01T00:00:00Z', level: 'info', code: 'step_started', message: 'Synthetic fetch', data: { stepId: 'fetch' } }]);
    const core = { store: { listExecutions: () => [{ id: 'synthetic-growing', status: 'running', errorCode: null,
      hasOutput: false, historyDiagnostics: [], logJson }] } } as unknown as AxCore;
    expect(buildExecutions(core)[0]).toMatchObject({ currentStepId: 'fetch' });
    logJson = JSON.stringify([
      ...JSON.parse(logJson),
      { at: '2026-09-01T00:00:01Z', level: 'info', code: 'step_started', message: 'Synthetic send', data: { stepId: 'send' } },
    ]);
    expect(buildExecutions(core)[0]).toMatchObject({ currentStepId: 'send' });
  });

  it('names a run and counts its current step the way people do', () => {
    const ir = { version: 1, name: '주간 매출 보고', goal: 'g', trigger: { type: 'manual' }, inputs: [], permissions: {}, approval: [],
      allowExternalAuto: false, assumptions: [], sideEffects: {}, dataPolicy: {},
      steps: [
        { type: 'action', id: 'read_sales', connector: 'rdb', action: 'query.read', params: { table: 'orders' }, sideEffect: 'NONE' },
        { type: 'action', id: 'eval_total_2', connector: 'transform', action: 'evaluate', params: {}, sideEffect: 'NONE' },
      ] };
    const core = { store: { listExecutions: () => [{ id: 'run-names', workflowId: null, ephemeral: true, status: 'running',
      errorCode: null, hasOutput: false, historyDiagnostics: [], irJson: JSON.stringify(ir),
      logJson: JSON.stringify([{ at: '2026-09-01T00:00:00Z', level: 'info', code: 'step_started', message: 'Synthetic step', data: { stepId: 'eval_total_2' } }]),
    }] } } as unknown as AxCore;
    expect(buildExecutions(core)[0]).toMatchObject({ name: '주간 매출 보고', currentStepId: 'eval_total_2', currentStepNumber: 2 });
  });
});
