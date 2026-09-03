import { z } from 'zod';
import { InvestigationOutputSchema } from '../investigation-schema.js';
import type { Step } from '../../workflow/schema.js';

const MAX_OUTPUT_PREVIEW_FIELDS = 16;
const MAX_OUTPUT_PREVIEW_CHARS = 400;

function truncateModelInput(value: string, maxChars: number): string {
  const trimmed = value.trim();
  return trimmed.length > maxChars
    ? `${trimmed.slice(0, maxChars)}\n...[이하 생략]`
    : trimmed;
}

function previewOutputValue(value: unknown): string {
  if (typeof value === 'string') return truncateModelInput(value, MAX_OUTPUT_PREVIEW_CHARS);
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return truncateModelInput(JSON.stringify(value), MAX_OUTPUT_PREVIEW_CHARS);
  } catch {
    return '[표시할 수 없는 값]';
  }
}

export function previewDecisionOutput(output: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(output)
      .slice(0, MAX_OUTPUT_PREVIEW_FIELDS)
      .map(([key, value]) => [key, previewOutputValue(value)]),
  );
}

export function mapInvestigationOutput(
  step: Step & { type: 'ai_decision' },
  output: Record<string, unknown>,
): Record<string, unknown> {
  return { ...output };
}

export function investigationSchemaFor(
  step: Step & { type: 'ai_decision' },
  requireDeclaredFields = true,
): z.ZodTypeAny {
  const properties = step.outputSchema?.properties;
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) {
    return InvestigationOutputSchema;
  }

  const required = new Set(
    Array.isArray(step.outputSchema?.required)
      ? requireDeclaredFields
        ? step.outputSchema.required.filter((value): value is string => typeof value === 'string')
        : []
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

export function requiredOutputFields(step: Step & { type: 'ai_decision' }): string[] {
  return Array.isArray(step.outputSchema?.required)
    ? step.outputSchema.required.filter((value): value is string => typeof value === 'string')
    : [];
}
