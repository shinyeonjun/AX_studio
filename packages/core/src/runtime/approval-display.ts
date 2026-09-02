import { resolveCapability } from '../catalog/capability-graph.js';
import type { WorkflowIR, Step } from '../workflow/schema.js';

type ActionStep = Extract<Step, { type: 'action' }>;

function actionDetail(step: ActionStep, cap: ReturnType<typeof resolveCapability>): string {
  const param = cap?.params.find((candidate) => candidate.displayInApproval);
  const value = param ? step.params[param.name] : undefined;
  return value == null || typeof value === 'object' ? '' : String(value);
}

export function approvalReasonForAction(workName: string, step: ActionStep): string {
  const cap = resolveCapability(step.connector, step.action);
  const actionLabel = cap?.label ?? `${step.connector}.${step.action}`;
  const detail = actionDetail(step, cap);
  return detail ? `${workName} — ${actionLabel} (${detail})` : `${workName} — ${actionLabel}`;
}

export function formatApprovalTitle(params: {
  workName?: string;
  reason: string;
  actionIds: string[];
  ir?: WorkflowIR | null;
}): string {
  const workName = params.workName ?? '업무';
  if (params.ir) {
    for (const actionId of params.actionIds) {
      const step = params.ir.steps.find((candidate) => candidate.type === 'action' && candidate.id === actionId);
      if (step?.type === 'action') {
        return approvalReasonForAction(workName, step);
      }
    }
  }
  if (params.reason === '실행 전 승인' || params.reason.includes('실행 전 승인')) {
    return `${workName} 실행 승인`;
  }
  return params.reason;
}
