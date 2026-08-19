import type { AgentHarness } from '../agent/harness.js';
import type { WorkflowStore } from '../store/workflow-store.js';
import type { WorkflowIR } from '../workflow/schema.js';
import { KO } from '../i18n/ko.js';
import { WorkflowRevisionSchema } from './revision-schema.js';

export function explainExecution(store: WorkflowStore, question: string): string {
  const executions = store.listExecutions(20);
  const latest = executions[0];
  if (!latest) return KO.execution.noRecentRuns;

  const q = question.toLowerCase();
  if (q.includes('왜') || q.includes('안') || q.includes('실패')) {
    if (latest.status === 'failed' || latest.errorCode) {
      const code = latest.errorCode ?? 'unknown';
      const log = JSON.parse(latest.logJson ?? '[]') as Array<{ level?: string; message?: string; code?: string }>;
      const detail = log.find((l) => l.level === 'error')?.message;
      return [
        KO.execution.failedAt(latest.startedAt),
        KO.execution.cause(KO.execution.errorMessages[code] ?? code),
        detail ? KO.execution.detail(detail) : '',
        KO.execution.recommendedAction,
      ].filter(Boolean).join('\n');
    }
    return KO.execution.statusAt(latest.startedAt, latest.status);
  }

  return KO.execution.recent(latest.startedAt, latest.status, latest.errorCode);
}

export interface WorkflowRevisionOptions {
  harness?: AgentHarness;
}

export async function proposeWorkflowRevision(
  current: Partial<WorkflowIR>,
  instruction: string,
  options: WorkflowRevisionOptions = {},
): Promise<{ proposal: string; changes: string[] }> {
  if (options.harness) {
    const { output } = await options.harness.run({
      role: 'revise',
      outputSchema: WorkflowRevisionSchema,
      user: instruction,
      context: {
        workflowJson: JSON.stringify(current, null, 2),
        instruction,
      },
    });
    return WorkflowRevisionSchema.parse(output);
  }

  return {
    proposal: KO.revision.fallbackProposal(current.goal, instruction),
    changes: [],
  };
}
