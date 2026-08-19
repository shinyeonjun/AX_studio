import type { ModelProvider } from '../models/provider.js';
import type { SkillIR } from '../skill/schema.js';
import { buildIRFromWorkflow } from './workflow-builder.js';
import { buildDirectCompileSystemPrompt } from './interview-prompt.js';
import { InterviewDraftSchema } from './workflow-schema.js';

export async function directCompileInstruction(
  instruction: string,
  model: ModelProvider,
): Promise<Partial<SkillIR>> {
  const parsed = InterviewDraftSchema.parse(
    await model.generateStructured({
      schema: InterviewDraftSchema,
      system: buildDirectCompileSystemPrompt(new Date().toISOString()),
      user: instruction,
      temperature: 0.1,
    }),
  );
  return buildIRFromWorkflow(parsed);
}
