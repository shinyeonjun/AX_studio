import type { ZodType } from 'zod';
import { zodToJsonSchema } from './convert.js';

/** Codex output-schema needs a finite, required-keys JSON Schema without empty objects or oneOf. */
export function zodToCodexJsonSchema(schema: ZodType): Record<string, unknown> {
  const sanitized = sanitizeCodexSchema(zodToJsonSchema(schema));
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
