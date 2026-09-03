import type { ConnectorContext } from '../../modules/types.js';
import { suggestRepairCandidates } from '../../workflow/repair.js';
import type { ExecutionProgress } from '../types.js';
import type { Step, WorkflowIR } from '../../workflow/schema.js';
import type { WorkflowExecutionHost } from './contracts.js';

export function reportStepProgress(
  host: WorkflowExecutionHost,
  ctx: ConnectorContext,
  step: Step,
  status: ExecutionProgress['status'],
  message = status === 'step_started' ? '단계를 시작했습니다.' : '단계를 완료했습니다.',
): void {
  const at = new Date().toISOString();
  ctx.log({
    at,
    level: status === 'step_failed' ? 'error' : status === 'waiting_approval' ? 'warn' : 'info',
    code: status,
    message,
    data: { stepId: step.id, stepType: step.type },
  });
  host.notifyExecutionProgress({
    executionId: ctx.executionId,
    stepId: step.id,
    status,
    at,
    message,
  });
}

export function recordRepairProposal(host: WorkflowExecutionHost, workflow: WorkflowIR, stepId: string, data: unknown): void {
  try {
    if (!workflow.id || !workflow.outputContract) return;
    // Ephemeral plans and unsaved drafts must not create durable repair state.
    if (!host.config.store.getWorkflow(workflow.id, workflow.version)) return;
    const candidates = suggestRepairCandidates(workflow.outputContract, stepId, data);
    if (candidates.length === 0) return;
    host.config.store.createRepairProposal({
      workflowId: workflow.id,
      baseVersion: workflow.version,
      candidates,
    });
  } catch {
    // The quality gate remains authoritative even if the optional proposal
    // persistence path is unavailable.
  }
}
