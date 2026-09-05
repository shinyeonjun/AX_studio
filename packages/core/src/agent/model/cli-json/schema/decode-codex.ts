import type { ZodType } from 'zod';
import { zodToCodexJsonSchema } from './codex.js';

type Schema = Record<string, unknown>;

/** Inverse of the Codex wire conversion, applied only at that provider boundary.
 * Domain Zod validation still runs afterwards; never guess query syntax or types.
 */
export function decodeCodexOutput(value: unknown, schema: ZodType): unknown {
  return decode(value, zodToCodexJsonSchema(schema));
}

function invalidJson(): Error {
  return Object.assign(new Error('model_output_invalid'), { code: 'model_output_invalid' });
}

function decode(value: unknown, schema: Schema): unknown {
  if (Array.isArray(schema.anyOf)) {
    if (value === null) return null;
    const branch = schema.anyOf.find((candidate) => (
      !!candidate && typeof candidate === 'object' && (candidate as Schema).type !== 'null'
    ));
    return branch && typeof branch === 'object' ? decode(value, branch as Schema) : value;
  }
  if (Array.isArray(schema.oneOf)) {
    const branch = schema.oneOf.find((candidate) => !!candidate && typeof candidate === 'object');
    return branch && typeof branch === 'object' ? decode(value, branch as Schema) : value;
  }
  const properties = schema.properties as Record<string, Schema> | undefined;
  const encoded = schema.type === 'string' && typeof schema.description === 'string'
    && schema.description.includes('encoded as a string');
  if (encoded) {
    if (typeof value !== 'string') return value;
    try { return JSON.parse(value); } catch { throw invalidJson(); }
  }
  if (schema.type === 'array' && Array.isArray(value)) {
    return value.map((item) => decode(item, schema.items as Schema));
  }
  if (properties && value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => {
      if (!Object.hasOwn(properties, key)) return [[key, item]];
      if (item === null && isOptionalWireValue(properties[key]!)) return [];
      return [[key, decode(item, properties[key]!)]];
    }));
  }
  return value;
}

function isOptionalWireValue(schema: Schema): boolean {
  return typeof schema.description === 'string'
    && schema.description.includes('optional field is absent')
    && Array.isArray(schema.anyOf) && schema.anyOf.some((candidate) => (
    !!candidate && typeof candidate === 'object' && (candidate as Schema).type === 'null'
  ));
}
