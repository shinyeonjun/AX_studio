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

/** Codex `--output-schema` needs a finite, required-keys JSON Schema without empty objects or oneOf. */
export function zodToCodexJsonSchema(schema: ZodType): Record<string, unknown> {
  const sanitized = sanitizeCodexSchema(convert(schema));
  if (sanitized.type !== 'object') {
    throw new Error(
      'Codex structured output schema must have a top-level object. Use a provider-specific wire envelope for union or scalar output.',
    );
  }
  return sanitized;
}

function isCodexSafeProperty(value: Record<string, unknown>): boolean {
  if (value.enum) return true;
  if (value.type === 'string' || value.type === 'number' || value.type === 'boolean' || value.type === 'array') {
    return true;
  }
  if (value.type === 'object') {
    const properties = value.properties as Record<string, unknown> | undefined;
    if (properties && Object.keys(properties).length > 0) return true;
    const additional = value.additionalProperties;
    if (additional && additional !== false && typeof additional === 'object' && Object.keys(additional as object).length > 0) {
      return true;
    }
  }
  return false;
}

function sanitizeCodexSchema(node: Record<string, unknown>): Record<string, unknown> {
  if (Array.isArray(node.oneOf) || Array.isArray(node.anyOf)) {
    return {
      type: 'string',
      description: 'JSON value encoded as a string',
    };
  }

  if (node.type === 'array' && node.items && typeof node.items === 'object' && !Array.isArray(node.items)) {
    node.items = sanitizeCodexSchema(node.items as Record<string, unknown>);
  }

  if (node.type === 'object') {
    const rawProperties = (node.properties ?? {}) as Record<string, Record<string, unknown>>;
    const properties: Record<string, Record<string, unknown>> = {};
    for (const [key, value] of Object.entries(rawProperties)) {
      const cleaned = sanitizeCodexSchema(value);
      if (!isCodexSafeProperty(cleaned)) continue;
      properties[key] = cleaned;
    }

    if (
      node.additionalProperties &&
      typeof node.additionalProperties === 'object' &&
      !Array.isArray(node.additionalProperties) &&
      Object.keys(node.additionalProperties as object).length === 0
    ) {
      node.additionalProperties = { type: 'string' };
    }

    if (Object.keys(properties).length > 0) {
      node.properties = properties;
      node.required = Object.keys(properties);
      node.additionalProperties = false;
    } else if (node.additionalProperties && node.additionalProperties !== false) {
      return {
        type: 'string',
        description: 'JSON object encoded as a string',
      };
    } else {
      return { type: 'object', additionalProperties: { type: 'string' } };
    }
  }

  return node;
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
      if (typeof def.value === 'number') return { type: 'number', enum: [def.value] };
      if (typeof def.value === 'boolean') return { type: 'boolean', enum: [def.value] };
      return { type: 'string', enum: [String(def.value)] };
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
    case 'ZodLazy':
      return { type: 'object', additionalProperties: { type: 'string' } };
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
      return { type: 'string' };
  }
}

function isOptional(schema: ZodType): boolean {
  const typeName = (schema as ZodType & { _def: { typeName: string } })._def.typeName;
  return typeName === 'ZodOptional' || typeName === 'ZodDefault';
}
