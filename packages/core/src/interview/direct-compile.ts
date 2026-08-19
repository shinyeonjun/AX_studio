import type { AgentHarness } from '../agent/harness.js';
import type { SkillIR } from '../skill/schema.js';
import { buildIRFromWorkflow } from './workflow-builder.js';
import { InterviewDraftSchema } from './workflow-schema.js';

export async function directCompileInstruction(
  instruction: string,
  harness: AgentHarness,
  connectedConnectors: string[] = [],
): Promise<Partial<SkillIR>> {
  const { output } = await harness.run({
    role: 'direct_compile',
    outputSchema: InterviewDraftSchema,
    user: instruction,
    context: {
      connectedConnectors,
      nowIso: new Date().toISOString(),
    },
  });
  return buildIRFromWorkflow(InterviewDraftSchema.parse(output));
}
