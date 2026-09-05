import { readFile } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { runCommand } from '../cli-process.js';
import { CodexCliProvider } from './adapters/codex-cli.js';
import { ReportBusinessInferenceSchema, ReportCaptureInferenceSchema } from '../../../report-generation/planner/schema.js';
import { zodToCodexJsonSchema } from '../cli-json.js';

vi.mock('../cli-process.js', () => ({ resolveBinary: () => 'codex', runCommand: vi.fn() }));
afterEach(() => vi.resetAllMocks());

function respond(output: unknown) {
  vi.mocked(runCommand).mockResolvedValue({ stdout: JSON.stringify(output), stderr: '', exitCode: 0 });
}

describe('Codex provider wire round trip', () => {
  it('describes recursive business expressions and restores them at the provider boundary', async () => {
    const wire = zodToCodexJsonSchema(ReportBusinessInferenceSchema);
    expect(String(wire.description)).toContain('count_distinct');
    expect(String(wire.description)).toContain('coalesce');
    const expression = { kind: 'arithmetic', operation: 'add', left: { kind: 'count' }, right: { kind: 'count' } };
    respond({
      schemaVersion: 1,
      reportPlan: { schemaVersion: 1, baseSource: 'ledger', joins: [],
        scalars: [{ id: 'total', expression: JSON.stringify(expression), format: null }], tables: [], texts: [] },
      layout: { schemaVersion: 1, outputFileName: 'report.pdf', scalarBindings: [], tableBindings: [] },
    });
    const result = await new CodexCliProvider('test').generateStructured({ schema: ReportBusinessInferenceSchema, system: 's', user: 'u' });
    expect(result.reportPlan.scalars[0]).toEqual({ id: 'total', expression });
  });
  it('restores report query records and absent optional fields through the actual adapter', async () => {
    const value = {
      schemaVersion: 1,
      examplePeriod: { start: '2034-02-01', endInclusive: '2034-02-28', label: 'example' },
      targetPeriod: { start: '2034-03-01', endInclusive: '2034-03-31', label: 'target' },
      capturePlan: { schemaVersion: 1, http: [{
        alias: 'ledger', connectionId: 'source', path: '/entries', rowsPath: 'items',
        staticQuery: JSON.stringify({ settled: true, limit: 31, region: 'west' }),
        dateQuery: null, pagination: null,
      }], rdb: [] },
    };
    vi.mocked(runCommand).mockImplementation(async (_command, args) => {
      const schema = JSON.parse(await readFile(args[args.indexOf('--output-schema') + 1]!, 'utf8'));
      const fields = schema.properties.capturePlan.properties.http.items.properties;
      expect(fields.dateQuery.anyOf).toContainEqual({ type: 'null' });
      return { stdout: JSON.stringify(value), stderr: '', exitCode: 0 };
    });
    const result = await new CodexCliProvider('test').generateStructured({
      schema: ReportCaptureInferenceSchema, system: 'test', user: 'report',
    });
    expect(result.capturePlan.http[0]).toEqual({
      alias: 'ledger', connectionId: 'source', path: '/entries', rowsPath: 'items',
      staticQuery: { settled: true, limit: 31, region: 'west' },
    });
  });

  it('restores nested unions and defaults without parsing ordinary text or discarding real null', async () => {
    const schema = z.object({
      items: z.array(z.object({ rule: z.union([z.object({ count: z.number() }), z.object({ flag: z.boolean() })]) })),
      note: z.string(), enabled: z.boolean().default(false), nullable: z.string().nullable().optional(),
      requiredNullable: z.string().nullable(),
    });
    respond({ items: [{ rule: '{"count":3}' }, { rule: '{"flag":false}' }], note: '{"literal":true}', enabled: null, nullable: null, requiredNullable: null });
    await expect(new CodexCliProvider('test').generateStructured({ schema, system: 's', user: 'u' })).resolves.toEqual({
      items: [{ rule: { count: 3 } }, { rule: { flag: false } }], note: '{"literal":true}', enabled: false, requiredNullable: null,
    });
  });

  it('keeps a normal optional nullable string as a string', async () => {
    const schema = z.object({ value: z.string().nullable().optional() });
    respond({ value: 'USD' });
    await expect(new CodexCliProvider('test').generateStructured({ schema, system: 's', user: 'u' })).resolves.toEqual({ value: 'USD' });
  });

  it.each(['not-json', '{"amount":{}}', '{"amount":"wrong"}'])('rejects invalid record %s without exposing content', async (record) => {
    respond({ record });
    await expect(new CodexCliProvider('test').generateStructured({
      schema: z.object({ record: z.record(z.number()) }), system: 's', user: 'u',
    })).rejects.toMatchObject({ code: 'model_output_invalid' });
  });
});
