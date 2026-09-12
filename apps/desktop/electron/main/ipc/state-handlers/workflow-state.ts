import type { AxCore } from '../../core-instance.js';
import type { WorkflowIR } from '@ax-studio/core';

type WorkflowDetails = { version: number; goal: string; trigger: WorkflowIR['trigger']; connectors: string[] };
const workflowDetails = new WeakMap<AxCore['store'], Map<string, WorkflowDetails>>();

export function buildWorkflowSummaries(core: Pick<AxCore, 'store'>) {
  const summaries = core.store.listWorkflows();
  const executions = new Map(core.store.listLatestWorkflowExecutions().map(execution => [execution.workflowId, execution]));
  const cache = workflowDetails.get(core.store) ?? new Map<string, WorkflowDetails>();
  workflowDetails.set(core.store, cache);
  const visible = new Set(summaries.map(summary => summary.id));
  for (const id of cache.keys()) if (!visible.has(id)) cache.delete(id);
  return summaries.map((summary) => {
    let details = cache.get(summary.id);
    if (!details || details.version !== summary.latestVersion) {
      const ir = core.store.getWorkflow(summary.id);
      details = { version: summary.latestVersion, goal: ir?.goal ?? '', trigger: ir?.trigger,
        connectors: [...new Set(ir?.steps.flatMap(step => step.type === 'action' ? [step.connector] : []) ?? [])] };
      cache.set(summary.id, details);
    }
    const lastExecution = executions.get(summary.id);
    return {
      ...summary,
      goal: details.goal,
      trigger: details.trigger,
      connectors: details.connectors,
      lastRunAt: lastExecution?.startedAt,
      lastStatus: lastExecution?.status,
    };
  });
}
