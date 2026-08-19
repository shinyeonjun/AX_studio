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

export function parseStructuredOutput<T>(raw: string, schema: ZodType<T>): T {
  const parsed = parseJsonObject(raw);
  if (parsed && typeof parsed === 'object') {
    const record = parsed as Record<string, unknown>;
    if (record.structured_output) return schema.parse(record.structured_output);
    if (typeof record.result === 'string') {
      try {
        return schema.parse(parseJsonObject(record.result));
      } catch {
        /* fall through */
      }
    }
    const direct = schema.safeParse(parsed);
    if (direct.success) return direct.data;
  }
  return schema.parse(parsed);
}

export function zodToJsonSchema(schema: ZodType): Record<string, unknown> {
  return convert(schema);
}

function convert(schema: ZodType): Record<string, unknown> {
  const def = (schema as ZodType & { _def: { typeName: string; innerType?: ZodType; values?: string[]; type?: ZodType } })._def;
  switch (def.typeName) {
    case 'ZodOptional':
    case 'ZodDefault':
      return convert(def.innerType as ZodType);
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
