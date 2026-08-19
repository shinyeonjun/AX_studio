import { resolveCapability } from '../catalog/capability-graph.js';
import type { WorkflowIR, Step } from '../workflow/schema.js';

type ActionStep = Extract<Step, { type: 'action' }>;

function actionDetail(step: ActionStep): string {
  if (step.connector === 'gmail' && step.action.includes('send') && step.params.to) {
    return String(step.params.to);
  }
  if (step.connector === 'slack' && step.action.includes('send') && step.params.channel) {
    return String(step.params.channel);
  }
  return '';
}

export function approvalReasonForAction(workName: string, step: ActionStep): string {
  const cap = resolveCapability(step.connector, step.action);
  const actionLabel =
    cap?.id === 'gmail.message.send'
      ? 'Gmail 메일 보내기'
      : cap?.id === 'slack.message.send'
        ? 'Slack 메시지 보내기'
        : `${step.connector}.${step.action}`;
  const detail = actionDetail(step);
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
  if (params.reason.includes('gmail') && params.reason.includes('send')) {
    return `${workName} — Gmail 메일 보내기`;
  }
  if (params.reason === '실행 전 승인' || params.reason.includes('실행 전 승인')) {
    return `${workName} 실행 승인`;
  }
  return params.reason;
}
