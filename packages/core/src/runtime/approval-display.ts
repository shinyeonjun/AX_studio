import { resolveCapability } from '../connectors/capability-graph.js';
import type { SkillIR, Step } from '../skill/schema.js';

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

export function approvalReasonForAction(skillName: string, step: ActionStep): string {
  const cap = resolveCapability(step.connector, step.action);
  const actionLabel =
    cap?.id === 'gmail.message.send'
      ? 'Gmail 메일 보내기'
      : cap?.id === 'slack.message.send'
        ? 'Slack 메시지 보내기'
        : `${step.connector}.${step.action}`;
  const detail = actionDetail(step);
  return detail ? `${skillName} — ${actionLabel} (${detail})` : `${skillName} — ${actionLabel}`;
}

export function formatApprovalTitle(params: {
  skillName?: string;
  reason: string;
  actionIds: string[];
  ir?: SkillIR | null;
}): string {
  const skillName = params.skillName ?? '업무';
  if (params.ir) {
    for (const actionId of params.actionIds) {
      const step = params.ir.steps.find((candidate) => candidate.type === 'action' && candidate.id === actionId);
      if (step?.type === 'action') {
        return approvalReasonForAction(skillName, step);
      }
    }
  }
  if (params.reason.includes('gmail') && params.reason.includes('send')) {
    return `${skillName} — Gmail 메일 보내기`;
  }
  if (params.reason === '실행 전 승인' || params.reason.includes('실행 전 승인')) {
    return `${skillName} 실행 승인`;
  }
  return params.reason;
}
