import type { ZodType } from 'zod';

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
