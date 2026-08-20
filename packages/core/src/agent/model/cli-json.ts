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
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error('AI structured output was empty');
  }
  if (trimmed.startsWith('error:') || trimmed.startsWith('Error:')) {
    throw new Error(trimmed.split('\n')[0]!.slice(0, 500));
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    if (err instanceof SyntaxError) {
      throw new Error(`AI structured output was not valid JSON: ${trimmed.slice(0, 160)}`);
    }
    throw err;
  }
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

/** Codex `--output-schema` requires every property key to appear in `required`. */
export function zodToCodexJsonSchema(schema: ZodType): Record<string, unknown> {
  const json = convert(schema);
  if (json.type === 'object' && json.properties && typeof json.properties === 'object') {
    const properties = Object.fromEntries(
      Object.entries(json.properties as Record<string, Record<string, unknown>>).filter(([, value]) => {
        if (value.type !== 'object') return true;
        if (value.properties && Object.keys(value.properties).length > 0) return true;
        return false;
      }),
    ) as Record<string, unknown>;
    json.properties = properties;
    json.required = Object.keys(properties);
  }
  return json;
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
    case 'ZodRecord': {
      const valueSchema = convert(def.valueType as ZodType);
      const additionalProperties =
        Object.keys(valueSchema).length > 0 ? valueSchema : { type: 'string' };
      return { type: 'object', additionalProperties };
    }
    case 'ZodUnknown':
    case 'ZodAny':
      return { type: 'string' };
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
