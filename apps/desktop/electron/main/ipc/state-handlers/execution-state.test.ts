import { describe, expect, it, vi } from 'vitest';
import type { AxCore } from '../../core-instance.js';
import { buildPendingApprovals } from './execution-state.js';

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
