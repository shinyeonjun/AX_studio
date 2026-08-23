import { resolveCapability } from '../../../catalog/capability-graph.js';
import { KO } from '../../../i18n/ko.js';
import { formatCondition } from '../../../runtime/condition-expr.js';
import type { WorkflowIR, Step } from '../../../workflow/schema.js';

function triggerSummary(trigger?: WorkflowIR['trigger']): string {
  if (!trigger || trigger.type === 'manual') return KO.chatSummary.triggerManual;
  if (trigger.type === 'once') {
    return trigger.filter
      ? `${KO.chatSummary.triggerOnce} · 조건: ${formatCondition(trigger.filter)}`
      : KO.chatSummary.triggerOnce;
  }
  if (trigger.type === 'schedule') {
    return KO.workflowDocument.triggerSchedule(trigger.schedule, trigger.timezone ?? '?');
  }
  if (trigger.type === 'gmail.new_message') {
    const base = KO.workflowDocument.triggerGmail(trigger.accountId);
    return trigger.filter ? `${base} · 조건: ${formatCondition(trigger.filter)}` : base;
  }
  if (trigger.type === 'slack.new_message') {
    const base = KO.workflowDocument.triggerSlack(trigger.channel);
    return trigger.filter ? `${base} · 조건: ${formatCondition(trigger.filter)}` : base;
  }
  if (trigger.type === 'local_folder.new_file') {
    const ext = trigger.extensions?.length ? ` · ${trigger.extensions.join(', ')}` : '';
    const filter = trigger.filter ? ` · 조건: ${formatCondition(trigger.filter)}` : '';
    return `로컬 폴더 새 파일 · ${trigger.folderId}${ext}${filter}`;
  }
  return KO.chatSummary.triggerManual;
}

function actionSummary(step: Extract<Step, { type: 'action' }>): string {
  const cap = resolveCapability(step.connector, step.action);
  if (cap?.id === 'gmail.message.send') {
    const to = step.params.to ? String(step.params.to) : '';
    const subject = step.params.subject ? String(step.params.subject) : '';
    if (to && subject) return `Gmail로 ${to}에 「${subject}」 메일 보내기`;
    if (to) return `Gmail로 ${to}에 메일 보내기`;
    return 'Gmail 메일 보내기';
  }
  if (cap?.id === 'slack.message.send') {
    const channel = step.params.channel ? String(step.params.channel) : '';
    return channel ? `Slack ${channel}에 메시지 보내기` : 'Slack 메시지 보내기';
  }
  const params = Object.entries(step.params)
    .slice(0, 2)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(', ');
  return params ? `${step.connector}.${step.action} (${params})` : `${step.connector}.${step.action}`;
}

export function renderChatSummary(ir: Partial<WorkflowIR>): string {
  const name = ir.name ?? KO.work.defaultName;
  const lines: string[] = [name];
  if (ir.goal?.trim()) lines.push(ir.goal.trim());
  lines.push('', `실행: ${triggerSummary(ir.trigger)}`);

  const actions = (ir.steps ?? []).filter((step): step is Extract<Step, { type: 'action' }> => step.type === 'action');
  if (actions.length > 0) {
    lines.push('', '할 일');
    for (const step of actions) {
      lines.push(`· ${actionSummary(step)}`);
    }
  }

  const needsApproval = (ir.steps ?? []).some(
    (step) => step.type === 'human_approval' || (step.type === 'action' && step.sideEffect === 'EXTERNAL_HIGH'),
  );
  if (needsApproval) {
    lines.push('', '외부 작업은 승인 후 실행됩니다.');
  }

  if (ir.success?.trim()) {
    lines.push('', `완료: ${ir.success.trim()}`);
  }

  return lines.join('\n');
}

export function summarizeWorkflow(ir: Partial<WorkflowIR>): string {
  return renderChatSummary(ir);
}
