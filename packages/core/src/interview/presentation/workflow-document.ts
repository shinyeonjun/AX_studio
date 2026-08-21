import type { WorkflowIR } from '../../workflow/schema.js';
import { formatCondition } from '../../runtime/condition-expr.js';
import { KO } from '../../i18n/ko.js';

function triggerLines(ir: Partial<WorkflowIR>): string[] {
  if (ir.trigger?.type === 'schedule') {
    return [
      'trigger:',
      '  type: schedule',
      `  schedule: ${ir.trigger.schedule}`,
      `  timezone: ${ir.trigger.timezone ?? '?'}`,
    ];
  }
  if (ir.trigger?.type === 'once') {
    const lines = ['trigger:', '  type: once', `  runAt: ${ir.trigger.runAt}`];
    if (ir.trigger.filter) lines.push(`  filter: ${formatCondition(ir.trigger.filter)}`);
    return lines;
  }
  if (ir.trigger?.type === 'gmail.new_message') {
    const lines = ['trigger:', '  type: gmail.new_message', `  accountId: ${ir.trigger.accountId}`];
    if (ir.trigger.filter) lines.push(`  filter: ${formatCondition(ir.trigger.filter)}`);
    return lines;
  }
  if (ir.trigger?.type === 'slack.new_message') {
    const lines = ['trigger:', '  type: slack.new_message', `  channel: ${ir.trigger.channel}`];
    if (ir.trigger.filter) lines.push(`  filter: ${formatCondition(ir.trigger.filter)}`);
    return lines;
  }
  if (ir.trigger?.type === 'local_folder.new_file') {
    const lines = ['trigger:', '  type: local_folder.new_file', `  folderId: ${ir.trigger.folderId}`];
    if (ir.trigger.folderPath) lines.push(`  folderPath: ${ir.trigger.folderPath}`);
    if (ir.trigger.extensions?.length) {
      lines.push(`  extensions: ${ir.trigger.extensions.join(', ')}`);
    }
    if (ir.trigger.filter) lines.push(`  filter: ${formatCondition(ir.trigger.filter)}`);
    return lines;
  }
  return ['trigger:', '  type: manual'];
}

function stepLine(step: NonNullable<WorkflowIR['steps']>[number]): string {
  if (step.type === 'action') {
    const params = Object.entries(step.params)
      .map(([key, value]) => `${key}=${String(value)}`)
      .join(', ');
    return `- action \`${step.connector}.${step.action}\`${params ? ` (${params})` : ''}`;
  }
  if (step.type === 'ai_decision') return `- ai_decision: ${step.goal}${step.memo?.trim() ? ` (memo: ${step.memo.trim().slice(0, 80)})` : ''}`;
  if (step.type === 'if') return `- if \`${formatCondition(step.condition)}\``;
  return `- human_approval: ${step.reason}`;
}

export function renderWorkflowDocument(ir: Partial<WorkflowIR>): string {
  const name = ir.name ?? KO.work.defaultName;
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9가-힣]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 64) || 'workflow';
  const steps = (ir.steps ?? []).map(stepLine);
  const assumptions = (ir.assumptions ?? []).map((item) => `- ${item}`);
  const sections = [
    '---',
    `name: ${slug}`,
    `description: ${ir.goal ?? ''}`,
    ...triggerLines(ir),
    '---',
    '',
    `# ${name}`,
    '',
    ir.goal ?? '',
    '',
    '## ' + KO.workflowDocument.sectionWorkflow,
    '',
    ...(steps.length > 0 ? steps : [KO.workflowDocument.noSteps]),
  ];
  if (ir.success) {
    sections.push('', '## ' + KO.workflowDocument.sectionCompletion, '', ir.success);
  }
  if (assumptions.length > 0) {
    sections.push('', '## ' + KO.workflowDocument.sectionAssumptions, '', ...assumptions);
  }
  return `${sections.join('\n')}\n`;
}
