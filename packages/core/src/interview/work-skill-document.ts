import type { SkillIR } from '../skill/schema.js';
import { KO } from '../i18n/ko.js';

function triggerLines(ir: Partial<SkillIR>): string[] {
  if (ir.trigger?.type === 'schedule') {
    return [
      'trigger:',
      '  type: schedule',
      `  schedule: ${ir.trigger.schedule}`,
      `  timezone: ${ir.trigger.timezone ?? 'Asia/Seoul'}`,
    ];
  }
  if (ir.trigger?.type === 'once') {
    return ['trigger:', '  type: once', `  runAt: ${ir.trigger.runAt}`];
  }
  if (ir.trigger?.type === 'gmail.new_message') {
    return ['trigger:', '  type: gmail.new_message', `  accountId: ${ir.trigger.accountId}`];
  }
  if (ir.trigger?.type === 'slack.new_message') {
    return ['trigger:', '  type: slack.new_message', `  channel: ${ir.trigger.channel}`];
  }
  return ['trigger:', '  type: manual'];
}

function stepLine(step: NonNullable<SkillIR['steps']>[number]): string {
  if (step.type === 'action') {
    const params = Object.entries(step.params)
      .map(([key, value]) => `${key}=${String(value)}`)
      .join(', ');
    return `- action \`${step.connector}.${step.action}\`${params ? ` (${params})` : ''}`;
  }
  if (step.type === 'ai_decision') return `- ai_decision: ${step.goal}`;
  if (step.type === 'if') return `- if \`${step.condition}\``;
  return `- human_approval: ${step.reason}`;
}

export function renderWorkSkillMarkdown(ir: Partial<SkillIR>): string {
  const name = ir.name ?? KO.skill.defaultName;
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9가-힣]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 64) || 'work-skill';
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
    '## ' + KO.workSkillDocument.sectionWorkflow,
    '',
    ...(steps.length > 0 ? steps : [KO.workSkillDocument.noSteps]),
  ];
  if (ir.success) {
    sections.push('', '## ' + KO.workSkillDocument.sectionCompletion, '', ir.success);
  }
  if (assumptions.length > 0) {
    sections.push('', '## ' + KO.workSkillDocument.sectionAssumptions, '', ...assumptions);
  }
  return `${sections.join('\n')}\n`;
}
