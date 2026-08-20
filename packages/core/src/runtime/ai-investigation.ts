import type { Connector, ConnectorContext } from '../modules/types.js';
import type { AgentHarness } from '../agent/harness.js';
import { extractGmailPlainBody } from '../modules/gmail/body-extract.js';
import { performCapabilityRead } from './capability-read.js';
import { evaluateCondition } from './condition-expr.js';
import { InvestigationOutputSchema } from './investigation-schema.js';
import type { WorkflowIR, Step } from '../workflow/schema.js';

export { evaluateCondition } from './condition-expr.js';

const INVESTIGATION_LIMIT_MESSAGE = 'Max investigation reads reached';

function documentTextFromRun(
  variables: Record<string, unknown>,
  stepResults: Record<string, unknown>,
): string | undefined {
  for (const key of ['transformText', 'documentText', 'text', 'body']) {
    const value = variables[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  for (const result of Object.values(stepResults).reverse()) {
    if (typeof result === 'string' && result.trim()) return result;
    if (!result || typeof result !== 'object') continue;
    const record = result as Record<string, unknown>;
    for (const key of ['text', 'body', 'summary']) {
      const candidate = record[key];
      if (typeof candidate === 'string' && candidate.trim() && candidate !== INVESTIGATION_LIMIT_MESSAGE) {
        return candidate;
      }
    }
  }
  return undefined;
}

function emailBodyFromRun(
  variables: Record<string, unknown>,
  stepResults: Record<string, unknown>,
): string | undefined {
  for (const result of Object.values(stepResults)) {
    const body = extractGmailPlainBody(result);
    if (body?.trim()) return body;
  }
  const snippet = variables.snippet ?? variables.body ?? variables.text;
  return snippet != null ? String(snippet) : undefined;
}

function buildInvestigationUser(
  step: Step & { type: 'ai_decision' },
  ctx: ConnectorContext,
  stepResults: Record<string, unknown>,
): string {
  const lines = [`Task: ${step.goal}`];
  if (ctx.variables.subject) lines.push(`Subject: ${String(ctx.variables.subject)}`);
  const from = ctx.variables.from ?? ctx.variables.sender;
  if (from) lines.push(`From: ${String(from)}`);
  const body = emailBodyFromRun(ctx.variables, stepResults);
  if (body) lines.push(`Body:\n${body}`);
  const documentText = documentTextFromRun(ctx.variables, stepResults);
  if (documentText && documentText !== body) {
    lines.push(`Document:\n${documentText.slice(0, 12_000)}`);
  }
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
  if (!path.includes('.')) {
    if (path in ctx.variables) return ctx.variables[path];
    if (path in stepResults) return stepResults[path];
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

function investigationUserPrompt(
  step: Step & { type: 'ai_decision' },
  ctx: ConnectorContext,
  stepResults: Record<string, unknown>,
  extra?: string,
): string {
  const base = buildInvestigationUser(step, ctx, stepResults);
  if (!step.investigation) {
    return `${base}\n\n추가 조회 없이 지금 결론만 내세요. needMore는 false로 두세요.`;
  }
  return extra ? `${base}\n\n${extra}` : base;
}

export async function runAiDecision(
  step: Step & { type: 'ai_decision' },
  ir: WorkflowIR,
  ctx: ConnectorContext,
  stepResults: Record<string, unknown>,
  agentHarness: AgentHarness | undefined,
  connectors: Record<string, Connector>,
): Promise<void> {
  const allowReads = step.investigation === true;
  const maxReads = allowReads ? (step.maxReads ?? 4) : 1;
  let reads = 0;
  const evidence: Array<{ source: string; detail: string }> = [];
  const untrustedBody = emailBodyFromRun(ctx.variables, stepResults);

  while (reads < maxReads) {
    if (agentHarness) {
      const { output } = await agentHarness.run({
        role: 'investigate',
        outputSchema: InvestigationOutputSchema,
        user: investigationUserPrompt(step, ctx, stepResults),
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

      if (allowReads && output.needMore && output.nextRead) {
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

  if (agentHarness) {
    const { output } = await agentHarness.run({
      role: 'investigate',
      outputSchema: InvestigationOutputSchema,
      user: investigationUserPrompt(step, ctx, stepResults, '추가 조회 없이 지금 결론만 내세요.'),
      cloudAllowed: ir.dataPolicy?.emailBody?.cloudAllowed === true,
      context: {
        skillGoal: ir.goal,
        taskGoal: step.goal,
        evidence,
        connectedConnectors: Object.keys(connectors),
        untrustedData: untrustedBody,
      },
    });
    if (output.conclusion?.trim() && output.conclusion.trim() !== INVESTIGATION_LIMIT_MESSAGE) {
      stepResults[step.id] = mapInvestigationOutput(step, output);
      return;
    }
  }

  const fallbackText = documentTextFromRun(ctx.variables, stepResults)?.slice(0, 2_000);
  stepResults[step.id] = {
    conclusion: fallbackText || '앞 단계 내용을 요약하지 못했습니다.',
    summary: fallbackText || '앞 단계 내용을 요약하지 못했습니다.',
    evidence,
  };
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
  if (!resolved.text && ctx.variables.documentHtml) resolved.text = String(ctx.variables.documentHtml).slice(0, 500);
  if (!resolved.body && stepResults.classify) resolved.body = JSON.stringify(stepResults.classify);
  return resolved;
}
