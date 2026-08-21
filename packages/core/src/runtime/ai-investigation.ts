import type { Connector, ConnectorContext } from '../modules/types.js';
import type { AgentHarness } from '../agent/harness.js';
import { z } from 'zod';
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

export function buildInvestigationUser(
  step: Step & { type: 'ai_decision' },
  ctx: ConnectorContext,
  stepResults: Record<string, unknown>,
): string {
  const lines = [`Task: ${step.goal}`];
  if (step.memo?.trim()) {
    lines.push(`Criteria:\n${step.memo.trim()}`);
  }
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
  return { ...output };
}

function investigationSchemaFor(step: Step & { type: 'ai_decision' }): z.ZodTypeAny {
  const properties = step.outputSchema?.properties;
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) {
    return InvestigationOutputSchema;
  }

  const required = new Set(
    Array.isArray(step.outputSchema?.required)
      ? step.outputSchema.required.filter((value): value is string => typeof value === 'string')
      : [],
  );
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [key, definition] of Object.entries(properties)) {
    const type = definition && typeof definition === 'object' && !Array.isArray(definition)
      ? (definition as Record<string, unknown>).type
      : undefined;
    const enumValues = definition && typeof definition === 'object' && !Array.isArray(definition)
      ? (definition as Record<string, unknown>).enum
      : undefined;
    let field: z.ZodTypeAny =
      Array.isArray(enumValues) && enumValues.every((value) => typeof value === 'string')
        ? z.enum(enumValues as [string, ...string[]]) :
      type === 'string' ? z.string() :
      type === 'number' || type === 'integer' ? z.number() :
      type === 'boolean' ? z.boolean() :
      type === 'array' ? z.array(z.unknown()) :
      z.unknown();
    if (!required.has(key)) field = field.optional();
    shape[key] = field;
  }
  return InvestigationOutputSchema.extend(shape);
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
    if (Array.isArray(current)) {
      if (/^\d+$/.test(key)) {
        current = current[Number(key)];
        continue;
      }
      const item = current.find(
        (candidate) => candidate && typeof candidate === 'object' && key in (candidate as Record<string, unknown>),
      );
      if (item && typeof item === 'object') {
        current = (item as Record<string, unknown>)[key];
        continue;
      }
      if (key === 'messageId') {
        const message = current.find(
          (candidate) => candidate && typeof candidate === 'object' && 'id' in (candidate as Record<string, unknown>),
        );
        current = message && typeof message === 'object' ? (message as Record<string, unknown>).id : undefined;
        continue;
      }
      return undefined;
    }
    if (!current || typeof current !== 'object') return undefined;
    const record = current as Record<string, unknown>;
    current = key === 'messageId' && record[key] == null ? record.id : record[key];
  }
  return current;
}

function resolveParamValue(
  value: unknown,
  ctx: ConnectorContext,
  stepResults: Record<string, unknown>,
): unknown {
  if (typeof value === 'string') {
    const exact = value.match(/^\{\{\s*([^{}]+?)\s*\}\}$/);
    if (exact) {
      const path = exact[1]!.trim();
      const resolved = lookupTemplatePath(path, ctx, stepResults);
      if (resolved == null) {
        throw Object.assign(new Error(`워크플로우 참조를 해석할 수 없습니다: ${path}`), {
          code: 'unresolved_binding',
          reference: path,
        });
      }
      return resolved;
    }
    return interpolateTemplates(value, ctx, stepResults);
  }
  if (Array.isArray(value)) return value.map((item) => resolveParamValue(item, ctx, stepResults));
  if (!value || typeof value !== 'object') return value;

  const record = value as Record<string, unknown>;
  if (Object.keys(record).length === 1 && typeof record.ref === 'string') {
    const reference = record.ref.trim();
    const resolved = lookupTemplatePath(reference, ctx, stepResults);
    if (resolved == null) {
      throw Object.assign(new Error(`워크플로우 참조를 해석할 수 없습니다: ${reference}`), {
        code: 'unresolved_binding',
        reference,
      });
    }
    return resolved;
  }
  return Object.fromEntries(
    Object.entries(record).map(([key, item]) => [key, resolveParamValue(item, ctx, stepResults)]),
  );
}

function interpolateTemplates(
  value: string,
  ctx: ConnectorContext,
  stepResults: Record<string, unknown>,
): string {
  return value.replace(/\{\{([^}]+)\}\}/g, (_all, rawPath: string) => {
    const resolved = lookupTemplatePath(rawPath.trim(), ctx, stepResults);
    if (resolved == null) {
      throw Object.assign(new Error(`워크플로우 참조를 해석할 수 없습니다: ${rawPath.trim()}`), {
        code: 'unresolved_binding',
        reference: rawPath.trim(),
      });
    }
    return String(resolved);
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

  if (!agentHarness) {
    throw Object.assign(new Error(`AI 판단 단계 ${step.id}를 실행할 Agent Harness가 없습니다.`), {
      code: 'agent_unavailable',
    });
  }

  while (reads < maxReads) {
    {
      const { output } = await agentHarness.run({
        role: 'investigate',
        outputSchema: investigationSchemaFor(step),
        user: investigationUserPrompt(step, ctx, stepResults),
        cloudAllowed: ir.dataPolicy?.emailBody?.cloudAllowed === true,
        context: {
          skillGoal: ir.goal,
          taskGoal: step.goal,
          taskMemo: step.memo,
          evidence,
          connectedConnectors: Object.keys(connectors),
          untrustedData: untrustedBody,
        },
      });

      if (output.conclusion || Object.keys(output).some((key) => !['needMore', 'nextRead', 'nextReadParams', 'reason', 'evidence'].includes(key))) {
        stepResults[step.id] = mapInvestigationOutput(step, output);
        return;
      }

      if (allowReads && output.needMore && output.nextRead) {
        reads++;
        const readResult = await performCapabilityRead(
          output.nextRead,
          ctx,
          connectors,
          (output.nextReadParams as Record<string, unknown> | undefined) ?? ({} as Record<string, unknown>),
        );
        evidence.push({ source: output.nextRead, detail: JSON.stringify(readResult).slice(0, 500) });
        continue;
      }

      stepResults[step.id] = mapInvestigationOutput(step, output);
      return;
    }
  }

  {
    const { output } = await agentHarness.run({
      role: 'investigate',
      outputSchema: investigationSchemaFor(step),
      user: investigationUserPrompt(step, ctx, stepResults, '추가 조회 없이 지금 결론만 내세요.'),
      cloudAllowed: ir.dataPolicy?.emailBody?.cloudAllowed === true,
      context: {
        skillGoal: ir.goal,
        taskGoal: step.goal,
        taskMemo: step.memo,
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
  throw Object.assign(new Error(`AI 판단 단계 ${step.id}가 유효한 결과를 반환하지 않았습니다.`), {
    code: 'ai_output_missing',
  });
}

export function resolveStepParams(
  params: Record<string, unknown>,
  ctx: ConnectorContext,
  stepResults: Record<string, unknown>,
): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    resolved[key] = resolveParamValue(value, ctx, stepResults);
  }
  return resolved;
}
