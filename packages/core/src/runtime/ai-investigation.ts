import type { Connector, ConnectorContext } from '../connectors/types.js';
import type { AgentHarness } from '../agent/harness.js';
import { performCapabilityRead } from './capability-read.js';
import { evaluateStepCondition } from './condition-eval.js';
import { InvestigationOutputSchema } from './investigation-schema.js';
import type { SkillIR, Step } from '../skill/schema.js';

export { evaluateStepCondition } from './condition-eval.js';

function triggerBody(variables: Record<string, unknown>): string | undefined {
  const body = variables.emailBody ?? variables.body ?? variables.snippet ?? variables.text;
  return body != null ? String(body) : undefined;
}

function buildInvestigationUser(step: Step & { type: 'ai_decision' }, ctx: ConnectorContext): string {
  const lines = [`Task: ${step.goal}`];
  if (ctx.variables.subject) lines.push(`Subject: ${String(ctx.variables.subject)}`);
  const from = ctx.variables.from ?? ctx.variables.sender;
  if (from) lines.push(`From: ${String(from)}`);
  const body = triggerBody(ctx.variables);
  if (body) lines.push(`Body:\n${body}`);
  return lines.join('\n\n');
}

function mapInvestigationOutput(
  step: Step & { type: 'ai_decision' },
  output: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...output };
  const conclusion = typeof output.conclusion === 'string' ? output.conclusion.trim() : '';
  if (!conclusion) return result;

  const properties = step.outputSchema?.properties;
  if (properties && typeof properties === 'object') {
    for (const key of Object.keys(properties as Record<string, unknown>)) {
      if (result[key] == null || result[key] === '') {
        result[key] = conclusion;
      }
    }
  }
  return result;
}

function lookupTemplatePath(
  path: string,
  ctx: ConnectorContext,
  stepResults: Record<string, unknown>,
): unknown {
  if (path.startsWith('trigger.')) {
    return ctx.variables[path.slice('trigger.'.length)];
  }
  const [stepId, ...rest] = path.split('.');
  let current: unknown = stepResults[stepId];
  for (const key of rest) {
    if (!current || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function interpolateTemplates(
  value: string,
  ctx: ConnectorContext,
  stepResults: Record<string, unknown>,
): string {
  return value.replace(/\{\{([^}]+)\}\}/g, (_all, rawPath: string) => {
    const resolved = lookupTemplatePath(rawPath.trim(), ctx, stepResults);
    return resolved == null ? '' : String(resolved);
  });
}

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
  const untrustedBody = triggerBody(ctx.variables);

  while (reads < maxReads) {
    if (agentHarness) {
      const { output } = await agentHarness.run({
        role: 'investigate',
        outputSchema: InvestigationOutputSchema,
        user: buildInvestigationUser(step, ctx),
        cloudAllowed: ir.dataPolicy?.emailBody?.cloudAllowed === true,
        context: {
          skillGoal: ir.goal,
          taskGoal: step.goal,
          evidence,
          connectedConnectors: Object.keys(connectors),
          untrustedData: untrustedBody,
        },
      });

      if (output.conclusion) {
        stepResults[step.id] = mapInvestigationOutput(step, output);
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

      stepResults[step.id] = mapInvestigationOutput(step, output);
      return;
    }

    stepResults[step.id] = {
      category: 'critical',
      confidence: 0.9,
      conclusion: 'Mock classification',
      summary: 'Mock classification',
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
  const resolved: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    resolved[key] = typeof value === 'string' ? interpolateTemplates(value, ctx, stepResults) : value;
  }
  if (!resolved.text && typeof resolved.message === 'string') {
    resolved.text = resolved.message;
  }
  if (!resolved.text && ctx.variables.reportHtml) resolved.text = String(ctx.variables.reportHtml).slice(0, 500);
  if (!resolved.body && stepResults.classify) resolved.body = JSON.stringify(stepResults.classify);
  return resolved;
}
