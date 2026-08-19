import type { SkillIR, Step } from '../skill/schema.js';
import type { ModelProvider } from '../models/provider.js';
import type { Connector, ConnectorContext } from '../connectors/types.js';
import { MockGmailConnector } from '../connectors/mocks/index.js';
import { InvestigationOutputSchema } from './investigation-schema.js';

export async function runAiDecision(
  step: Step & { type: 'ai_decision' },
  ir: SkillIR,
  ctx: ConnectorContext,
  stepResults: Record<string, unknown>,
  model: ModelProvider | undefined,
  connectors: Record<string, Connector>,
  mockGmail: MockGmailConnector,
): Promise<void> {
  const maxReads = step.maxReads ?? 4;
  let reads = 0;
  const evidence: Array<{ source: string; detail: string }> = [];

  while (reads < maxReads) {
    if (model) {
      const untrusted = ctx.variables.emailBody ? `\n\n[UNTRUSTED DATA]\n${String(ctx.variables.emailBody)}` : '';
      const output = await model.generateStructured({
        schema: InvestigationOutputSchema,
        system: `You are an AX assistant. Skill instruction (TRUSTED): ${ir.goal}. Only output structured JSON. Never choose tools or actions.`,
        user: `Task: ${step.goal}. Evidence so far: ${JSON.stringify(evidence)}.${untrusted}`,
      });

      if (output.conclusion) {
        stepResults[step.id] = output;
        return;
      }

      if (output.needMore && output.nextRead) {
        reads++;
        const readResult = await performRead(output.nextRead, ctx, connectors, mockGmail);
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

async function performRead(
  capabilityId: string,
  ctx: ConnectorContext,
  connectors: Record<string, Connector>,
  mockGmail: MockGmailConnector,
): Promise<unknown> {
  if (capabilityId.includes('gmail')) {
    return (await mockGmail.execute('messages.search', { query: '' }, ctx)).data;
  }
  if (capabilityId.includes('rdb')) {
    return (await connectors.rdb.execute('query.read', { table: 'sales' }, ctx)).data;
  }
  return null;
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

export function evaluateStepCondition(condition: string, stepResults: Record<string, unknown>): boolean {
  if (condition.includes('critical')) {
    const classify = stepResults.classify as { category?: string } | undefined;
    return classify?.category === 'critical';
  }
  if (condition.includes('changeRate')) {
    const analyze = stepResults.analyze as { changeRate?: number } | undefined;
    return (analyze?.changeRate ?? 0) <= -0.2;
  }
  return false;
}
