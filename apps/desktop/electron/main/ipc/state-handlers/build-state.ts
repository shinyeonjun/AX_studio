import type { AxCore } from '../../core-instance.js';
import { buildConnectorState } from './connector-state.js';
import { buildExecutions, buildPendingApprovals } from './execution-state.js';
import { buildWorkflowSummaries } from './workflow-state.js';

export async function buildAppState(core: AxCore) {
  const connectorStatePromise = buildConnectorState(core);
  const pendingApprovals = buildPendingApprovals(core);
  const executions = buildExecutions(core);
  const works = buildWorkflowSummaries(core, executions);
  const connectorState = await connectorStatePromise;

  return {
    globalActive: core.store.getGlobalActive(),
    ...connectorState,
    works,
    pendingApprovals: pendingApprovals.length,
    approvals: pendingApprovals,
    executions,
  };
}
