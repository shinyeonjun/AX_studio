import type { Connector, ConnectorContext } from '../connectors/types.js';
import type { AgentHarness } from '../agent/harness.js';
import { performCapabilityRead } from './capability-read.js';
import { evaluateStepCondition } from './condition-eval.js';
import { InvestigationOutputSchema } from './investigation-schema.js';
import type { SkillIR, Step } from '../skill/schema.js';

export { evaluateStepCondition } from './condition-eval.js';

export async function runAiDecision(
  step: Step & { type: 'ai_decision' },
  ir: SkillIR,
  ctx: ConnectorContext,
  stepResults: Record<string, unknown>,
  agentHarness: AgentHarness | undefined,
  connectors: Record<string, Connector>,
): Promise<void> {
  const maxReads = step.maxReads ?? 4;
  let reads = 0;
  const evidence: Array<{ source: string; detail: string }> = [];

  while (reads < maxReads) {
    if (agentHarness) {
      const { output } = await agentHarness.run({
        role: 'investigate',
        outputSchema: InvestigationOutputSchema,
        cloudAllowed: ir.dataPolicy?.emailBody?.cloudAllowed === true,
        context: {
          skillGoal: ir.goal,
          taskGoal: step.goal,
          evidence,
          untrustedData: ctx.variables.emailBody ? String(ctx.variables.emailBody) : undefined,
        },
      });

      if (output.conclusion) {
        stepResults[step.id] = output;
        return;
      }

      if (output.needMore && output.nextRead) {
        reads++;
        const readResult = await performCapabilityRead(
          output.nextRead,
          ctx,
          connectors,
          output.nextReadParams ?? {},
        );
        evidence.push({ source: output.nextRead, detail: JSON.stringify(readResult).slice(0, 500) });
        continue;
      }

      stepResults[step.id] = output;
      return;
    }

    stepResults[step.id] = {
      category: 'critical',
      confidence: 0.9,
      conclusion: 'Mock classification',
      evidence,
    };
    return;
  }

  stepResults[step.id] = { conclusion: 'Max investigation reads reached', evidence };
}

export function resolveStepParams(
  params: Record<string, unknown>,
  ctx: ConnectorContext,
  stepResults: Record<string, unknown>,
): Record<string, unknown> {
  const resolved = { ...params };
  if (!resolved.text && ctx.variables.reportHtml) resolved.text = String(ctx.variables.reportHtml).slice(0, 500);
  if (!resolved.body && stepResults.classify) resolved.body = JSON.stringify(stepResults.classify);
  return resolved;
}
