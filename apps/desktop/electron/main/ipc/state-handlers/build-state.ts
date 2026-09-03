import type { AxCore } from '../../core-instance.js';
import { buildConnectorState } from './connector-state.js';
import { buildExecutions, buildPendingApprovals } from './execution-state.js';
import { buildWorkflowSummaries } from './workflow-state.js';

export async function buildAppState(core: AxCore) {
  const pendingApprovals = buildPendingApprovals(core);
  const executions = buildExecutions(core);
  const connectorState = await buildConnectorState(core);
  const works = buildWorkflowSummaries(core, executions);

  return {
    globalActive: core.store.getGlobalActive(),
    ...connectorState,
    works,
    pendingApprovals: pendingApprovals.length,
    approvals: pendingApprovals,
    executions,
  };
}
