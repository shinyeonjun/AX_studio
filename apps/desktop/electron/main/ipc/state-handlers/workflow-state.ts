import type { AxCore } from '../../core-instance.js';

export function buildWorkflowSummaries(
  core: AxCore,
  executions: Array<{ workflowId: string | null; startedAt: string; status: string }>,
) {
  return core.store.listWorkflows().map((summary) => {
    const ir = core.store.getWorkflow(summary.id);
    const connectors =
      ir?.steps
        ?.filter((step) => step.type === 'action')
        .map((step) => step.connector) ?? [];
    const lastExecution = executions.find((execution) => execution.workflowId === summary.id);
    return {
      ...summary,
      goal: ir?.goal ?? '',
      trigger: ir?.trigger,
      connectors: [...new Set(connectors)],
      lastRunAt: lastExecution?.startedAt,
      lastStatus: lastExecution?.status,
    };
  });
}
