import type { ZodType } from 'zod';
import { zodToJsonSchema } from './convert.js';

/** Required wire keys use null for absent optional values; records/unions use JSON strings. */
export function zodToCodexJsonSchema(schema: ZodType): Record<string, unknown> {
  const original = zodToJsonSchema(schema);
  const { $defs, ...root } = original;
  const sanitized = sanitizeCodexSchema(root);
  if ($defs) {
    sanitized.description = `Fields encoded as JSON strings must contain domain JSON, not nested wire encodings. Resolve their references using these definitions: ${JSON.stringify($defs)}`;
  }
  if (sanitized.type !== 'object') {
    throw new Error(
      'Codex structured output schema must have a top-level object. Use a provider-specific wire envelope for union or scalar output.',
    );
  }
  return sanitized;
}

function isCodexSafeProperty(value: Record<string, unknown>): boolean {
  if (Array.isArray(value.anyOf)) return true;
  if (value.type === 'null') return true;
  if (value.enum) return true;
  if (value.type === 'string' || value.type === 'number' || value.type === 'boolean' || value.type === 'array') {
    return true;
  }
  if (value.type === 'object') {
    const properties = value.properties as Record<string, unknown> | undefined;
    if (properties) return true;
    const additional = value.additionalProperties;
    if (additional && additional !== false && typeof additional === 'object' && Object.keys(additional as object).length > 0) {
      return true;
    }
  }
  return false;
}

function sanitizeCodexSchema(node: Record<string, unknown>): Record<string, unknown> {
  if (Array.isArray(node.anyOf) && isNullableSchema(node.anyOf)) {
    const valueSchema = node.anyOf.find((candidate) => (
      !!candidate && typeof candidate === 'object' && (candidate as Record<string, unknown>).type !== 'null'
    ));
    return {
      anyOf: [
        valueSchema && typeof valueSchema === 'object'
          ? sanitizeCodexSchema(valueSchema as Record<string, unknown>)
          : valueSchema,
        { type: 'null' },
      ],
    };
  }

  if (node.$ref || Array.isArray(node.oneOf) || Array.isArray(node.anyOf)) {
    return {
      type: 'string',
      description: `JSON value encoded as a string. Decoded value must satisfy: ${JSON.stringify(node)}`,
    };
  }

  if (node.type === 'array' && node.items && typeof node.items === 'object' && !Array.isArray(node.items)) {
    node.items = sanitizeCodexSchema(node.items as Record<string, unknown>);
  }

  if (node.type === 'object') {
    const rawProperties = (node.properties ?? {}) as Record<string, Record<string, unknown>>;
    const required = new Set(node.required as string[] ?? []);
    const properties: Record<string, Record<string, unknown>> = {};
    for (const [key, value] of Object.entries(rawProperties)) {
      const cleaned = sanitizeCodexSchema(value);
      if (!isCodexSafeProperty(cleaned)) continue;
      properties[key] = required.has(key) ? cleaned : {
        anyOf: [cleaned, { type: 'null' }],
        description: 'Use null when this optional field is absent. Do not invent a value.',
      };
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
        description: `JSON object encoded as a string. Decoded value must satisfy: ${JSON.stringify(node)}`,
      };
    } else {
      return { type: 'object', properties: {}, required: [], additionalProperties: false };
    }
  }

  return node;
}

function isNullableSchema(options: unknown[]): boolean {
  return options.length === 2 && options.some((option) => (
    !!option && typeof option === 'object' && (option as Record<string, unknown>).type === 'null'
  ));
}
