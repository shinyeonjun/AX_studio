import type { ZodType } from 'zod';

export function zodToJsonSchema(schema: ZodType): Record<string, unknown> {
  const context: ConversionContext = { names: new Map(), definitions: {} };
  const result = convert(schema, context);
  return Object.keys(context.definitions).length ? { ...result, $defs: context.definitions } : result;
}

interface ConversionContext {
  names: Map<ZodType, string>;
  definitions: Record<string, Record<string, unknown>>;
}

interface ZodCheck {
  kind: string;
  value?: number;
  inclusive?: boolean;
  regex?: RegExp;
}

interface ZodDefinition {
  checks?: ZodCheck[];
  minLength?: { value: number } | null;
  maxLength?: { value: number } | null;
  exactLength?: { value: number } | null;
  type?: ZodType;
}

function convert(schema: ZodType, context: ConversionContext): Record<string, unknown> {
  type ZodDef = {
    typeName: string;
    innerType?: ZodType;
    schema?: ZodType;
    values?: string[];
    value?: unknown;
    type?: ZodType;
    valueType?: ZodType;
    options?: ZodType[];
    getter?: () => ZodType;
    checks?: ZodCheck[];
    minLength?: { value: number } | null;
    maxLength?: { value: number } | null;
    exactLength?: { value: number } | null;
  };
  const def = (schema as ZodType & { _def: ZodDef })._def;
  switch (def.typeName) {
    case 'ZodOptional':
    case 'ZodDefault':
      return convert(def.innerType as ZodType, context);
    case 'ZodNullable':
      return { anyOf: [convert(def.innerType as ZodType, context), { type: 'null' }] };
    case 'ZodEffects':
      return convert(def.schema as ZodType, context);
    case 'ZodLiteral':
      if (def.value === null) return { type: 'null' };
      if (typeof def.value === 'number') return { type: 'number', enum: [def.value] };
      if (typeof def.value === 'boolean') return { type: 'boolean', enum: [def.value] };
      return { type: 'string', enum: [String(def.value)] };
    case 'ZodString':
      return stringSchema(def);
    case 'ZodNumber':
      return numberSchema(def);
    case 'ZodBoolean':
      return { type: 'boolean' };
    case 'ZodNull':
      return { type: 'null' };
    case 'ZodEnum':
      return { type: 'string', enum: def.values };
    case 'ZodArray':
      return arraySchema(def, context);
    case 'ZodRecord': {
      const valueSchema = convert(def.valueType as ZodType, context);
      const additionalProperties =
        Object.keys(valueSchema).length > 0 ? valueSchema : { type: 'string' };
      return { type: 'object', additionalProperties };
    }
    case 'ZodUnknown':
    case 'ZodAny':
      return { type: 'string' };
    case 'ZodLazy': {
      let name = context.names.get(schema);
      if (!name) {
        name = `schema${context.names.size}`;
        context.names.set(schema, name);
        context.definitions[name] = convert(def.getter!(), context);
      }
      return { $ref: `#/$defs/${name}` };
    }
    case 'ZodUnion':
    case 'ZodDiscriminatedUnion':
      return { oneOf: (def.options ?? []).map((option) => convert(option, context)) };
    case 'ZodObject': {
      const shape = (schema as unknown as { shape: Record<string, ZodType> }).shape;
      const properties: Record<string, Record<string, unknown>> = {};
      const required: string[] = [];
      for (const [key, value] of Object.entries(shape)) {
        properties[key] = convert(value, context);
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

function stringSchema(def: ZodDefinition): Record<string, unknown> {
  const schema: Record<string, unknown> = { type: 'string' };
  for (const check of def.checks ?? []) {
    if (check.kind === 'min' && check.value !== undefined) schema.minLength = check.value;
    if (check.kind === 'max' && check.value !== undefined) schema.maxLength = check.value;
    if (check.kind === 'length' && check.value !== undefined) {
      schema.minLength = check.value;
      schema.maxLength = check.value;
    }
    if (check.kind === 'regex' && check.regex instanceof RegExp) schema.pattern = check.regex.source;
  }
  return schema;
}

function numberSchema(def: ZodDefinition): Record<string, unknown> {
  const schema: Record<string, unknown> = { type: 'number' };
  for (const check of def.checks ?? []) {
    if (check.kind === 'int') schema.type = 'integer';
    if (check.kind === 'min' && check.value !== undefined) {
      schema[check.inclusive === false ? 'exclusiveMinimum' : 'minimum'] = check.value;
    }
    if (check.kind === 'max' && check.value !== undefined) {
      schema[check.inclusive === false ? 'exclusiveMaximum' : 'maximum'] = check.value;
    }
    if (check.kind === 'multipleOf' && check.value !== undefined) schema.multipleOf = check.value;
  }
  return schema;
}

function arraySchema(def: ZodDefinition, context: ConversionContext): Record<string, unknown> {
  const schema: Record<string, unknown> = { type: 'array', items: convert(def.type as ZodType, context) };
  if (def.minLength) schema.minItems = def.minLength.value;
  if (def.maxLength) schema.maxItems = def.maxLength.value;
  if (def.exactLength) {
    schema.minItems = def.exactLength.value;
    schema.maxItems = def.exactLength.value;
  }
  return schema;
}

function isOptional(schema: ZodType): boolean {
  const { typeName, schema: inner } = (schema as ZodType & { _def: { typeName: string; schema?: ZodType } })._def;
  if (typeName === 'ZodEffects' && inner) return isOptional(inner);
  return typeName === 'ZodOptional' || typeName === 'ZodDefault';
}
