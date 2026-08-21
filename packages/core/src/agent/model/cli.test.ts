import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { InvestigationOutputSchema } from '../../runtime/investigation-schema.js';
import { InterviewWireEnvelopeSchema } from '../../interview/agent/wire-schema.js';
import { parseCodexModelsOutput } from '../settings/catalog.js';
import { codexExecArgs } from './cli/adapters/codex-cli.js';
import { cliFailureMessage } from './cli/output.js';
import { parseStructuredOutput, parseJsonObject, zodToJsonSchema, zodToCodexJsonSchema } from './cli-json.js';
import { normalizeAiProviderConfig } from '../settings/config.js';

describe('normalizeAiProviderConfig', () => {
  it('migrates gpt-cli to codex-cli', () => {
    expect(normalizeAiProviderConfig({ provider: 'gpt-cli', model: 'gpt-4o-mini' })).toEqual({
      provider: 'codex-cli',
      brand: 'gpt',
      mode: 'cli',
      model: 'gpt-4o-mini',
    });
  });

  it('drops ollama api settings', () => {
    expect(normalizeAiProviderConfig({ provider: 'ollama', baseURL: 'http://localhost:11434/v1' }).provider).toBe(
      'claude-cli',
    );
  });
});

describe('parseCodexModelsOutput', () => {
  it('reads json model list', () => {
    const models = parseCodexModelsOutput(JSON.stringify({ models: [{ id: 'gpt-5.4', name: 'GPT 5.4' }] }));
    expect(models[0]).toEqual({ id: 'gpt-5.4', label: 'gpt-5.4' });
  });

  it('reads text lines', () => {
    const models = parseCodexModelsOutput('gpt-5.4-mini\no3\nnot-a-model');
    expect(models.map((m) => m.id)).toEqual(['gpt-5.4-mini', 'o3']);
  });
});

describe('cli json', () => {
  it('parses fenced json and claude wrapper', () => {
    const schema = z.object({ category: z.string() });
    expect(parseStructuredOutput('```json\n{"category":"critical"}\n```', schema)).toEqual({ category: 'critical' });
    expect(
      parseStructuredOutput(JSON.stringify({ structured_output: { category: 'ok' } }), schema),
    ).toEqual({ category: 'ok' });
  });

  it('skips empty structured_output and reads result json', () => {
    const schema = z.object({ name: z.string() });
    expect(
      parseStructuredOutput(
        JSON.stringify({
          type: 'result',
          structured_output: {},
          result: JSON.stringify({ name: 'PDF 요약' }),
        }),
        schema,
      ),
    ).toEqual({ name: 'PDF 요약' });
  });

  it('converts object schema', () => {
    const schema = z.object({
      name: z.string(),
      flag: z.boolean().default(false),
    });
    const json = zodToJsonSchema(schema);
    expect(json.type).toBe('object');
    expect((json.required as string[]).includes('name')).toBe(true);
    expect((json.required as string[]).includes('flag')).toBe(false);
  });

  it('converts record schema for CLI json-schema', () => {
    const schema = z.object({
      params: z.record(z.unknown()).optional(),
    });
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
    if (params) {
      expect(params.type).toBe('string');
    }
  });

  it('converts interview wire envelope for codex output-schema', () => {
    const json = zodToCodexJsonSchema(InterviewWireEnvelopeSchema);
    expect(json.type).toBe('object');
    expect(json.oneOf).toBeUndefined();
    expect(json.required).toEqual(Object.keys(json.properties as object));
    const properties = json.properties as Record<string, Record<string, unknown>>;
    expect(properties.kind.type).toBe('string');
    expect(properties.payload.type).toBe('string');
    expect(properties.toolCalls.type).toBe('string');
    expect(properties.nextQuestion.type).toBe('string');
    expect(JSON.stringify(json)).not.toContain('"oneOf"');
  });

  it('converts discriminated union schema for CLI json-schema', () => {
    const schema = z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('discover'), toolCalls: z.array(z.string()) }),
      z.object({ kind: z.literal('design'), name: z.string(), nextQuestion: z.string() }),
    ]);
    const json = zodToJsonSchema(schema);
    expect(Array.isArray(json.oneOf)).toBe(true);
    expect((json.oneOf as unknown[]).length).toBe(2);
  });

  it('surfaces CLI error text instead of raw JSON.parse messages', () => {
    expect(() => parseJsonObject('error: unexpected argument --json-schema')).toThrow(
      'error: unexpected argument --json-schema',
    );
  });
});

describe('codex cli adapter', () => {
  it('uses current codex exec flags', () => {
    const args = codexExecArgs('gpt-5.4', 'hello', ['-o', '/tmp/out.txt'], '/tmp/ax-cli');
    expect(args).toContain('-s');
    expect(args).toContain('read-only');
    expect(args).toContain('-C');
    expect(args).toContain('/tmp/ax-cli');
    expect(args).toContain('-c');
    expect(args).toContain('model_reasoning_effort=high');
    expect(args).not.toContain('--ask-for-approval');
    expect(args.at(-1)).toBe('hello');
  });

  it('extracts quoted message from truncated codex ERROR json', () => {
    const message = cliFailureMessage(
      {
        exitCode: 1,
        stdout: '',
        stderr: 'ERROR: {\n  "error": { "message": "schema is not valid" }',
      },
      'fallback',
    );
    expect(message).toBe('schema is not valid');
  });

  it('does not surface a lone brace as the CLI error', () => {
    const message = cliFailureMessage(
      {
        exitCode: 1,
        stdout: '',
        stderr: 'ERROR: {',
      },
      'Codex CLI 호출에 실패했습니다.',
    );
    expect(message).toBe('Codex CLI 호출에 실패했습니다.');
  });
});
