import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { InvestigationOutputSchema } from '../../../runtime/investigation-schema.js';
import { zodToJsonSchema, zodToCodexJsonSchema } from '../cli-json.js';

describe('cli schema conversion', () => {
  it('converts object schema', () => {
    const schema = z.object({ name: z.string(), flag: z.boolean().default(false) });
    const json = zodToJsonSchema(schema);
    expect(json.type).toBe('object');
    expect((json.required as string[]).includes('name')).toBe(true);
    expect((json.required as string[]).includes('flag')).toBe(false);
  });

  it('converts record schema for CLI json-schema', () => {
    const schema = z.object({ params: z.record(z.unknown()).optional() });
    const json = zodToJsonSchema(schema);
    const params = (json.properties as Record<string, Record<string, unknown>>).params;
    expect(params.additionalProperties).toEqual({ type: 'string' });
  });

  it('converts investigation schema for codex output-schema', () => {
    const json = zodToCodexJsonSchema(InvestigationOutputSchema);
    const properties = json.properties as Record<string, Record<string, unknown>>;
    expect(json.required).toEqual(Object.keys(properties));
    expect(properties.needMore).toEqual({ type: 'boolean' });
    const params = properties.nextReadParams;
    if (params) expect(params.type).toBe('string');
  });

  it('converts a generic discriminated union for CLI json-schema', () => {
    const schema = z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('first'), value: z.string() }),
      z.object({ kind: z.literal('second'), value: z.string() }),
    ]);
    const json = zodToJsonSchema(schema);
    expect(Array.isArray(json.oneOf)).toBe(true);
    expect((json.oneOf as unknown[]).length).toBe(2);
  });

  it('rejects a non-object root schema for Codex output-schema', () => {
    expect(() => zodToCodexJsonSchema(z.string())).toThrow(
      'Codex structured output schema must have a top-level object',
    );
  });
});
