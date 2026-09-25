import { describe, expect, it, vi } from 'vitest';
import type { AxCore } from '../../core-instance.js';
import { buildWorkflowSummaries } from './workflow-state.js';

describe('buildWorkflowSummaries', () => {
  it('uses one batched workflow read and preserves newest execution summaries', () => {
    const listWorkflowDefinitions = vi.fn(() => [{
      id: 'workflow-1', name: 'Inventory', active: true, latestVersion: 2,
      workflow: {
        id: 'workflow-1', name: 'Inventory', goal: 'Review stock', version: 2, steps: [
          { id: 'first', type: 'action' as const, connector: 'http', action: 'request' },
          { id: 'second', type: 'action' as const, connector: 'http', action: 'request' },
        ],
        permissions: {}, approval: [], allowExternalAuto: true,
        assumptions: [], sideEffects: {}, dataPolicy: {},
      },
    }]);
    const getWorkflow = vi.fn(() => { throw new Error('per-workflow reads are not expected'); });
    const core = { store: { listWorkflowDefinitions, getWorkflow } } as unknown as AxCore;

    expect(buildWorkflowSummaries(core, [
      { workflowId: 'workflow-1', startedAt: '2026-09-25T10:00:00Z', status: 'failed' },
      { workflowId: 'workflow-1', startedAt: '2026-09-24T10:00:00Z', status: 'success' },
    ])).toMatchObject([{
      id: 'workflow-1', goal: 'Review stock', latestVersion: 2,
      connectors: ['http'], lastRunAt: '2026-09-25T10:00:00Z', lastStatus: 'failed',
    }]);
    expect(listWorkflowDefinitions).toHaveBeenCalledOnce();
    expect(getWorkflow).not.toHaveBeenCalled();
  });
});
