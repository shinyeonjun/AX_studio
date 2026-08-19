import type { ZodType } from 'zod';

export function extractJsonText(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1);
  return trimmed;
}

export function parseJsonObject(raw: string): unknown {
  const text = extractJsonText(raw);
  return JSON.parse(text);
}

function structuredOutputCandidates(parsed: unknown): unknown[] {
  const candidates: unknown[] = [];
  const seen = new Set<unknown>();
  const push = (value: unknown) => {
    if (value == null || seen.has(value)) return;
    seen.add(value);
    candidates.push(value);
  };

  push(parsed);
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const record = parsed as Record<string, unknown>;
    for (const key of ['structured_output', 'result', 'data', 'output'] as const) {
      const nested = record[key];
      if (nested && typeof nested === 'object') push(nested);
      if (typeof nested === 'string') {
        try {
          push(parseJsonObject(nested));
        } catch {
          /* ignore non-json */
        }
      }
    }
  }
  return candidates;
}

export function parseStructuredOutput<T>(raw: string, schema: ZodType<T>): T {
  const parsed = parseJsonObject(raw);
  let lastError: unknown;
  for (const candidate of structuredOutputCandidates(parsed)) {
    const result = schema.safeParse(candidate);
    if (result.success) return result.data;
    lastError = result.error;
  }
  if (lastError instanceof Error) throw lastError;
  return schema.parse(parsed);
}

export function zodToJsonSchema(schema: ZodType): Record<string, unknown> {
  return convert(schema);
}

function convert(schema: ZodType): Record<string, unknown> {
  type ZodDef = {
    typeName: string;
    innerType?: ZodType;
    schema?: ZodType;
    values?: string[];
    value?: unknown;
    type?: ZodType;
    valueType?: ZodType;
    options?: ZodType[];
  };
  const def = (schema as ZodType & { _def: ZodDef })._def;
  switch (def.typeName) {
    case 'ZodOptional':
    case 'ZodDefault':
    case 'ZodNullable':
      return convert(def.innerType as ZodType);
    case 'ZodEffects':
      return convert(def.schema as ZodType);
    case 'ZodLiteral':
      return { enum: [def.value] };
    case 'ZodString':
      return { type: 'string' };
    case 'ZodNumber':
      return { type: 'number' };
    case 'ZodBoolean':
      return { type: 'boolean' };
    case 'ZodEnum':
      return { type: 'string', enum: def.values };
    case 'ZodArray':
      return { type: 'array', items: convert(def.type as ZodType) };
    case 'ZodRecord':
      return { type: 'object', additionalProperties: convert(def.valueType as ZodType) };
    case 'ZodUnion':
    case 'ZodDiscriminatedUnion':
      return { oneOf: (def.options ?? []).map((option) => convert(option)) };
    case 'ZodObject': {
      const shape = (schema as unknown as { shape: Record<string, ZodType> }).shape;
      const properties: Record<string, Record<string, unknown>> = {};
      const required: string[] = [];
      for (const [key, value] of Object.entries(shape)) {
        properties[key] = convert(value);
        if (!isOptional(value)) required.push(key);
      }
      return {
        type: 'object',
        properties,
        required,
        additionalProperties: false,
      };
    }
    default:
      return {};
  }
}

function isOptional(schema: ZodType): boolean {
  const typeName = (schema as ZodType & { _def: { typeName: string } })._def.typeName;
  return typeName === 'ZodOptional' || typeName === 'ZodDefault';
}
