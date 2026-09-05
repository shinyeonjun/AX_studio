import type { ConnectorContext } from '../../../modules/types.js';
import { extractGmailPlainBody } from '../../../modules/gmail/body-extract.js';
import type { WorkflowIR, Step } from '../../../workflow/schema.js';
import { resolveAiDecisionBindings } from '../../../workflow/bindings.js';
import { documentVisualsFromRun } from './visuals.js';

export const INVESTIGATION_LIMIT_MESSAGE = 'Max investigation reads reached';
const MAX_UNTRUSTED_EMAIL_CHARS = 12_000;
const MAX_UNTRUSTED_METADATA_CHARS = 2_000;

function truncateModelInput(value: string, maxChars: number): string {
  const trimmed = value.trim();
  return trimmed.length > maxChars
    ? `${trimmed.slice(0, maxChars)}\n...[이하 생략]`
    : trimmed;
}

export function documentTextFromRun(
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

export function emailBodyFromRun(
  variables: Record<string, unknown>,
  stepResults: Record<string, unknown>,
): string | undefined {
  for (const result of Object.values(stepResults)) {
    const body = extractGmailPlainBody(result);
    if (body?.trim()) return truncateModelInput(body, MAX_UNTRUSTED_EMAIL_CHARS);
  }
  const snippet = variables.snippet ?? variables.body ?? variables.text;
  return snippet != null ? truncateModelInput(String(snippet), MAX_UNTRUSTED_EMAIL_CHARS) : undefined;
}

export function buildInvestigationUser(
  step: Step & { type: 'ai_decision' },
  ctx: ConnectorContext,
  stepResults: Record<string, unknown>,
  options: { includeSensitiveData?: boolean; ir?: WorkflowIR } = {},
): string {
  const lines = [`Task: ${step.goal}`];
  if (step.memo?.trim()) {
    lines.push(`Criteria:\n${step.memo.trim()}`);
  }
  if (options.includeSensitiveData === false) return lines.join('\n\n');
  if (ctx.variables.subject) {
    lines.push(`Subject: ${truncateModelInput(String(ctx.variables.subject), MAX_UNTRUSTED_METADATA_CHARS)}`);
  }
  const from = ctx.variables.from ?? ctx.variables.sender;
  if (from) lines.push(`From: ${truncateModelInput(String(from), MAX_UNTRUSTED_METADATA_CHARS)}`);

  const boundContext = options.ir
    ? resolveAiDecisionBindings(step, options.ir, stepResults, ctx.variables, ctx.outputs)
    : undefined;

  if (boundContext?.usesExplicitBindings) {
    const body = boundContext.emailBody;
    if (body) lines.push(`Body:\n${body}`);
    const documentText = boundContext.documentText;
    if (documentText && documentText !== body) {
      lines.push(`Document:\n${documentText.slice(0, 12_000)}`);
    }
  } else {
    const body = emailBodyFromRun(ctx.variables, stepResults);
    if (body) lines.push(`Body:\n${body}`);
    const documentText = documentTextFromRun(ctx.variables, stepResults);
    if (documentText && documentText !== body) {
      lines.push(`Document:\n${documentText.slice(0, 12_000)}`);
    }
  }

  const documentVisuals = documentVisualsFromRun(ctx.variables, stepResults);
  if (documentVisuals) {
    lines.push(`Document visuals (image paths/OCR metadata):\n${documentVisuals}`);
  }
  return lines.join('\n\n');
}
