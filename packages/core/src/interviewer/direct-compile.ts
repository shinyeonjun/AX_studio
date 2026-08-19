import type { ModelProvider } from '../models/provider.js';
import type { SkillIR } from '../skill/schema.js';
import { buildIRFromDraft } from './draft-builder.js';
import { DraftIRSchema } from './draft-schema.js';

export async function directCompileInstruction(
  instruction: string,
  model?: ModelProvider,
): Promise<Partial<SkillIR>> {
  if (model) {
    const parsed = await model.generateStructured({
      schema: DraftIRSchema,
      system: 'Extract work task structure from user instruction. Do not invent connections not mentioned.',
      user: instruction,
    });
    return buildIRFromDraft({
      name: parsed.name,
      goal: parsed.goal,
      trigger:
        parsed.triggerType === 'schedule'
          ? { type: 'schedule', schedule: parsed.schedule ?? '0 9 * * 1', timezone: parsed.timezone ?? 'Asia/Seoul' }
          : parsed.triggerType === 'gmail.new_message'
            ? { type: 'gmail.new_message', accountId: parsed.gmailAccount ?? 'primary' }
            : { type: 'manual' },
      success: parsed.success,
      assumptions: parsed.assumptions,
      slackChannel: parsed.slackChannel,
      localFilePath: parsed.localFilePath,
      includeGmailSend: parsed.includeGmailSend,
      includeInvestigation: parsed.includeInvestigation,
    } as Partial<SkillIR>);
  }

  return buildIRFromDraft({
    name: '업무',
    goal: instruction,
    includeGmailSend: instruction.includes('답장') || instruction.includes('메일'),
    includeInvestigation: instruction.includes('조사') || instruction.includes('원인'),
    slackChannel: instruction.match(/#[\w-]+/)?.[0],
    localFilePath: instruction.includes('매출') ? './data/sales.csv' : undefined,
    triggerType:
      instruction.includes('매주') || instruction.includes('매달')
        ? 'schedule'
        : instruction.includes('메일')
          ? 'gmail.new_message'
          : 'manual',
    schedule: '0 9 * * 1',
    success: '완료',
  } as Partial<SkillIR>);
}
