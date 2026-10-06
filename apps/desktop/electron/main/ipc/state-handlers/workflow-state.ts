import type { AxCore } from '../../core-instance.js';
import { buildWorkflowAutomationHealth } from './diagnostics-state.js';

export function buildWorkflowSummaries(
  core: AxCore,
  executions: Array<{ workflowId: string | null; startedAt: string; status: string }>,
) {
  const latestExecutionByWorkflow = new Map<string, (typeof executions)[number]>();
  for (const execution of executions) {
    if (execution.workflowId && !latestExecutionByWorkflow.has(execution.workflowId)) {
      latestExecutionByWorkflow.set(execution.workflowId, execution);
    }
  }

  const definitions = core.store.listWorkflowDefinitions();
  const health = buildWorkflowAutomationHealth(core, definitions.map((definition) => definition.id));
  return definitions.map(({ workflow, ...summary }) => {
    const connectors = new Set<string>();
    for (const step of workflow?.steps ?? []) {
      if (step.type === 'action') connectors.add(step.connector);
    }
    const lastExecution = latestExecutionByWorkflow.get(summary.id);
    return {
      ...summary,
      goal: workflow?.goal ?? '',
      trigger: workflow?.trigger,
      connectors: [...connectors],
      lastRunAt: lastExecution?.startedAt,
      lastStatus: lastExecution?.status,
      triggerDeadLetters: health.get(summary.id)?.triggerDeadLetters ?? [],
      lastOutcome: health.get(summary.id)?.lastOutcome,
    };
  });
}
