import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { runCommand } from '../cli-process.js';
import { CodexCliProvider } from './adapters/codex-cli.js';
import { ReportBusinessInferenceSchema, ReportCalculationInferenceSchema, ReportCaptureInferenceSchema } from '../../../../documents/reporting/planner/schema.js';
import { ReportSourceDecisionWireSchema } from '../../../../documents/reporting/planner/source-discovery.js';
import { zodToCodexJsonSchema } from '../cli-json.js';
import { createAxCommandChatTransport } from '../../commands/transport.js';

vi.mock('../cli-process.js', () => ({ resolveBinary: () => 'codex', runCommand: vi.fn() }));
afterEach(() => vi.resetAllMocks());

function respond(output: unknown) {
  vi.mocked(runCommand).mockResolvedValue({ stdout: JSON.stringify(output), stderr: '', exitCode: 0 });
}

describe('Codex provider wire round trip', () => {
  it('creates the optional raw debug directory instead of failing the model call', async () => {
    const debugRoot = await mkdtemp(join(tmpdir(), 'ax-codex-debug-'));
    const debugDir = join(debugRoot, 'nested');
    const previousDebugDir = process.env.AX_REPORT_DEBUG_RAW_DIR;
    process.env.AX_REPORT_DEBUG_RAW_DIR = debugDir;
    respond({ value: 'ok' });
    try {
      await expect(new CodexCliProvider('test').generateStructured({
        schema: z.object({ value: z.string() }), system: 's', user: 'u',
      })).resolves.toEqual({ value: 'ok' });
      const files = await readdir(debugDir);
      expect(files).toHaveLength(1);
      expect(files[0]).toMatch(/structured\.json$/);
    } finally {
      if (previousDebugDir === undefined) delete process.env.AX_REPORT_DEBUG_RAW_DIR;
      else process.env.AX_REPORT_DEBUG_RAW_DIR = previousDebugDir;
      await rm(debugRoot, { recursive: true, force: true });
    }
  });
  it('allows the provider to return required pagination integers and optional inspection limits', async () => {
    const schema = z.object({ pagination: z.object({
      pageSize: z.number().int().min(1).max(10_000),
      maxPages: z.number().int().min(1).max(1_000),
      offset: z.number().int().min(0).optional(),
    }) });
    vi.mocked(runCommand).mockImplementation(async (_command, args) => {
      const wire = JSON.parse(await readFile(args[args.indexOf('--output-schema') + 1]!, 'utf8'));
      const pagination = wire.properties.pagination;
      expect(pagination.properties.pageSize).toEqual({ type: 'integer', minimum: 1, maximum: 10_000 });
      expect(pagination.properties.maxPages).toEqual({ type: 'integer', minimum: 1, maximum: 1_000 });
      expect(pagination.required).toEqual(['pageSize', 'maxPages', 'offset']);
      expect(pagination.properties.offset.anyOf).toContainEqual({ type: 'integer', minimum: 0 });
      return { stdout: JSON.stringify({ pagination: { pageSize: 100, maxPages: 50, offset: null } }), stderr: '', exitCode: 0 };
    });
    await expect(new CodexCliProvider('test').generateStructured({ schema, system: 's', user: 'u' }))
      .resolves.toEqual({ pagination: { pageSize: 100, maxPages: 50 } });
  });
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
  it('accepts metadata scalars and aggregate formulas in derived table cells', async () => {
    const table = {
      kind: 'aggregate', id: 'summary',
      groupBy: [{ id: 'region', value: { kind: 'field', path: 'ledger.region' } }],
      columns: [{
        id: 'attainment',
        value: {
          kind: 'derived',
          expression: {
            kind: 'arithmetic', operation: 'divide',
            left: { kind: 'sum', value: { kind: 'field', path: 'ledger.net' } },
            right: { kind: 'first', value: { kind: 'field', path: 'ledger.target' } },
          },
        },
      }],
    };
    respond({
      schemaVersion: 1,
      reportPlan: {
        schemaVersion: 1, baseSource: 'ledger', joins: [],
        scalars: [{ id: 'period', expression: JSON.stringify({
          kind: 'concat', values: [
            { kind: 'field', path: 'meta.periodLabel' },
            { kind: 'literal', value: ' report' },
          ],
        }) }],
        tables: [JSON.stringify(table)], texts: [],
      },
    });
    await expect(new CodexCliProvider('test').generateStructured({
      schema: ReportCalculationInferenceSchema, system: 's', user: 'u',
    })).resolves.toMatchObject({
      reportPlan: {
        scalars: [{ expression: { kind: 'concat' } }],
        tables: [{ columns: [{ value: { kind: 'derived', expression: { kind: 'arithmetic' } } }] }],
      },
    });
  });
  it('normalizes shorthand aggregate operators emitted by the model', async () => {
    respond({
      schemaVersion: 1,
      reportPlan: {
        schemaVersion: 1, baseSource: 'ledger', joins: [],
        scalars: [{ id: 'rate', expression: JSON.stringify({
          kind: 'divide',
          left: { kind: 'sum', value: JSON.stringify({ kind: 'field', path: 'ledger.refund' }) },
          right: { kind: 'sum', value: JSON.stringify({ kind: 'field', path: 'ledger.gross' }) },
        }) }],
        tables: [], texts: [],
      },
    });
    await expect(new CodexCliProvider('test').generateStructured({
      schema: ReportCalculationInferenceSchema, system: 's', user: 'u',
    })).resolves.toMatchObject({
      reportPlan: { scalars: [{ expression: { kind: 'arithmetic', operation: 'divide' } }] },
    });
  });
  it('accepts aggregate expressions nested in scalar prose concatenation', async () => {
    respond({
      schemaVersion: 1,
      reportPlan: {
        schemaVersion: 1, baseSource: 'ledger', joins: [],
        scalars: [{ id: 'summary', expression: JSON.stringify({
          kind: 'concat',
          values: [
            { kind: 'field', path: 'meta.periodLabel' },
            { kind: 'sum', value: { kind: 'field', path: 'ledger.amount' } },
            { kind: 'count' },
          ],
        }) }],
        tables: [], texts: [],
      },
    });
    await expect(new CodexCliProvider('test').generateStructured({
      schema: ReportCalculationInferenceSchema, system: 's', user: 'u',
    })).resolves.toMatchObject({
      reportPlan: { scalars: [{ expression: { kind: 'concat', values: [
        { kind: 'field' }, { kind: 'sum' }, { kind: 'count' },
      ] } }] },
    });
  });
  it('normalizes direct aggregate expressions emitted for grouped table cells', async () => {
    respond({
      schemaVersion: 1,
      reportPlan: {
        schemaVersion: 1, baseSource: 'ledger', joins: [],
        scalars: [],
        tables: [{ kind: 'aggregate', id: 'summary', groupBy: [{ id: 'region', value: {
          kind: 'field', path: 'ledger.region',
        } }], columns: [
          { id: 'region', value: { kind: 'group_key', keyId: 'region' } },
          { id: 'net', value: { kind: 'sum', value: { kind: 'field', path: 'ledger.net' } } },
          { id: 'rate', value: { kind: 'divide',
            left: { kind: 'sum', value: { kind: 'field', path: 'ledger.net' } },
            right: { kind: 'sum', value: { kind: 'field', path: 'ledger.target' } },
          } },
        ],
        }],
        texts: [],
      },
    });
    await expect(new CodexCliProvider('test').generateStructured({
      schema: ReportCalculationInferenceSchema, system: 's', user: 'u',
    })).resolves.toMatchObject({
      reportPlan: { tables: [{ columns: [
        { value: { kind: 'group_key', keyId: 'region' } },
        { value: { kind: 'aggregate', expression: { kind: 'sum' } } },
        { value: { kind: 'aggregate', expression: { kind: 'arithmetic', operation: 'divide' } } },
      ] }] },
    });
  });
  it('restores null optional fields before parsing the Codex command wire', async () => {
    respond({ kind: 'command', commandName: 'workflow.list', argsJson: null, message: null });
    const transport = createAxCommandChatTransport('codex-cli');
    await expect(new CodexCliProvider('test').generateStructured({
      schema: transport.outputSchema, system: 's', user: 'u',
    })).resolves.toEqual({ kind: 'command', commandName: 'workflow.list', argsJson: '', message: '' });
  });
  it('keeps JSON-looking command argsJson as wire text through the actual adapter', async () => {
    respond({ kind: 'command', commandName: 'report.generate', argsJson: JSON.stringify({
      goal: '월간 보고서', templateSourceId: 'src-template', exampleSourceId: 'src-example',
    }), message: null });
    const transport = createAxCommandChatTransport('codex-cli');
    await expect(new CodexCliProvider('test').generateStructured({
      schema: transport.outputSchema, system: 's', user: 'u',
    })).resolves.toEqual({
      kind: 'command', commandName: 'report.generate',
      argsJson: JSON.stringify({ goal: '월간 보고서', templateSourceId: 'src-template', exampleSourceId: 'src-example' }),
      message: '',
    });
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
  it('keeps source inspection requests as objects through the actual adapter', async () => {
    respond({
      schemaVersion: 1,
      status: 'need_evidence',
      plan: null,
      request: { kind: 'rdb_table', table: 'public.entries', connectionId: null },
      reason: null,
    });
    const result = await new CodexCliProvider('test').generateStructured({
      schema: ReportSourceDecisionWireSchema, system: 'test', user: 'source',
    });
    expect(result).toEqual({
      schemaVersion: 1,
      status: 'need_evidence',
      request: { kind: 'rdb_table', table: 'public.entries' },
    });
  });

  it('restores nested unions and defaults without parsing ordinary text or discarding real null', async () => {
    const schema = z.object({
      items: z.array(z.object({ rule: z.union([z.object({ count: z.number() }), z.object({ flag: z.boolean() })]) })),
      note: z.string(), enabled: z.boolean().default(false), nullable: z.string().nullable().optional(),
      requiredNullable: z.string().nullable(),
    });
    respond({ items: [{ rule: '{"count":3}' }, { rule: '{"flag":false}' }], note: '{"literal":true}', enabled: null,
      nullable: '{"literal":true}', requiredNullable: null });
    await expect(new CodexCliProvider('test').generateStructured({ schema, system: 's', user: 'u' })).resolves.toEqual({
      items: [{ rule: { count: 3 } }, { rule: { flag: false } }], note: '{"literal":true}', enabled: false,
      nullable: '{"literal":true}', requiredNullable: null,
    });
  });

  it('recursively decodes a domain object returned directly for an encoded calculation expression', async () => {
    respond({
      schemaVersion: 1,
      reportPlan: {
        schemaVersion: 1,
        baseSource: 'ledger',
        joins: [],
        scalars: [{
          id: 'total',
          expression: {
            kind: 'sum',
            value: JSON.stringify({ kind: 'field', path: 'ledger.amount' }),
            where: null,
          },
        }],
        tables: [],
        texts: [],
      },
    });
    await expect(new CodexCliProvider('test').generateStructured({
      schema: ReportCalculationInferenceSchema, system: 's', user: 'u',
    })).resolves.toMatchObject({
      reportPlan: { scalars: [{ expression: { kind: 'sum', value: { kind: 'field', path: 'ledger.amount' } } }] },
    });
  });

  it('reports the exact path when an encoded calculation expression is malformed JSON', async () => {
    respond({
      schemaVersion: 1,
      reportPlan: {
        schemaVersion: 1,
        baseSource: 'ledger',
        joins: [],
        scalars: [{ id: 'total', expression: '{not-json}' }],
        tables: [],
        texts: [],
      },
    });
    await expect(new CodexCliProvider('test').generateStructured({
      schema: ReportCalculationInferenceSchema, system: 's', user: 'u',
    })).rejects.toMatchObject({
      code: 'model_output_invalid',
      issues: [{ code: 'invalid_json', path: ['reportPlan', 'scalars', 0, 'expression'] }],
    });
  });

  it('drops an optional aggregate field when its null is itself JSON encoded', async () => {
    respond({
      schemaVersion: 1,
      reportPlan: {
        schemaVersion: 1,
        baseSource: 'ledger',
        joins: [],
        scalars: [{ id: 'total', expression: JSON.stringify({ kind: 'count', where: JSON.stringify(null) }) }],
        tables: [],
        texts: [],
      },
    });
    await expect(new CodexCliProvider('test').generateStructured({
      schema: ReportCalculationInferenceSchema, system: 's', user: 'u',
    })).resolves.toMatchObject({
      reportPlan: { scalars: [{ expression: { kind: 'count' } }] },
    });
  });

  it('recovers a valid encoded expression prefix when a model appends outer JSON fragments', async () => {
    const encoded = `${JSON.stringify({ kind: 'count' })}"},{`;
    respond({ schemaVersion: 1, reportPlan: {
      schemaVersion: 1, baseSource: 'ledger', joins: [],
      scalars: [{ id: 'total', expression: encoded }], tables: [], texts: [],
    } });
    await expect(new CodexCliProvider('test').generateStructured({
      schema: ReportCalculationInferenceSchema, system: 's', user: 'u',
    })).resolves.toMatchObject({ reportPlan: { scalars: [{ expression: { kind: 'count' } }] } });
  });

  it('deduplicates a repeated encoded expression emitted by the CLI wire', async () => {
    const encoded = JSON.stringify({ kind: 'count' });
    respond({ schemaVersion: 1, reportPlan: {
      schemaVersion: 1, baseSource: 'ledger', joins: [],
      scalars: [{ id: 'total', expression: [encoded, encoded, encoded, encoded].join('||||') }],
      tables: [], texts: [],
    } });
    await expect(new CodexCliProvider('test').generateStructured({
      schema: ReportCalculationInferenceSchema, system: 's', user: 'u',
    })).resolves.toMatchObject({ reportPlan: { scalars: [{ expression: { kind: 'count' } }] } });
  });

  it('recovers an encoded expression with only missing closing delimiters', async () => {
    const encoded = JSON.stringify({ kind: 'count' }).slice(0, -1);
    respond({ schemaVersion: 1, reportPlan: {
      schemaVersion: 1, baseSource: 'ledger', joins: [],
      scalars: [{ id: 'total', expression: encoded }], tables: [], texts: [],
    } });
    await expect(new CodexCliProvider('test').generateStructured({
      schema: ReportCalculationInferenceSchema, system: 's', user: 'u',
    })).resolves.toMatchObject({ reportPlan: { scalars: [{ expression: { kind: 'count' } }] } });
  });

  it('repairs a missing object delimiter before the next encoded table item', async () => {
    const valid = JSON.stringify({
      kind: 'aggregate', id: 'summary',
      groupBy: [{ id: 'region', value: { kind: 'field', path: 'region' } }],
      columns: [
        { id: 'region', value: { kind: 'group_key', keyId: 'region' } },
        { id: 'count', value: { kind: 'aggregate', expression: { kind: 'count' } } },
      ],
      limit: 5,
    });
    const malformed = valid.replace(
      '"keyId":"region"}},{"id":"count"',
      '"keyId":"region"},{"id":"count"',
    );
    respond({ schemaVersion: 1, reportPlan: {
      schemaVersion: 1, baseSource: 'ledger', joins: [],
      scalars: [], tables: [malformed], texts: [],
    } });
    await expect(new CodexCliProvider('test').generateStructured({
      schema: ReportCalculationInferenceSchema, system: 's', user: 'u',
    })).resolves.toMatchObject({
      reportPlan: { tables: [{ id: 'summary', columns: [{ id: 'region' }, { id: 'count' }] }] },
    });
  });

  it('repairs a missing array delimiter before a sibling encoded table property', async () => {
    const valid = JSON.stringify({
      kind: 'aggregate', id: 'summary',
      groupBy: [{ id: 'region', value: { kind: 'field', path: 'region' } }],
      columns: [
        { id: 'region', value: { kind: 'group_key', keyId: 'region' } },
        { id: 'count', value: { kind: 'aggregate', expression: { kind: 'count' } } },
      ],
      sort: [{ columnId: 'count', direction: 'desc' }],
      limit: 5,
    });
    const malformed = valid.replace('}],"sort"', '} ,"sort"'.replace(' ', ''));
    respond({ schemaVersion: 1, reportPlan: {
      schemaVersion: 1, baseSource: 'ledger', joins: [],
      scalars: [], tables: [malformed], texts: [],
    } });
    await expect(new CodexCliProvider('test').generateStructured({
      schema: ReportCalculationInferenceSchema, system: 's', user: 'u',
    })).resolves.toMatchObject({
      reportPlan: { tables: [{ id: 'summary', columns: [{ id: 'region' }, { id: 'count' }], sort: [{ columnId: 'count' }] }] },
    });
  });

  it('drops an extra object delimiter before the next encoded predicate item', async () => {
    const valid = JSON.stringify({
      kind: 'aggregate', id: 'summary',
      groupBy: [{ id: 'region', value: { kind: 'field', path: 'region' } }],
      columns: [{
        id: 'risk',
        value: {
          kind: 'derived',
          expression: {
            kind: 'case',
            branches: [{
              when: {
                kind: 'or',
                items: [
                  { kind: 'compare', operation: 'lt', left: { kind: 'literal', value: 1 }, right: { kind: 'literal', value: 0.8 } },
                  { kind: 'compare', operation: 'gt', left: { kind: 'literal', value: 0.05 }, right: { kind: 'literal', value: 0 } },
                ],
              },
              value: { kind: 'literal', value: 'risk' },
            }],
            fallback: { kind: 'literal', value: 'ok' },
          },
        },
      }],
    });
    const malformed = valid.replace('0.8}},', '0.8}}},');
    respond({ schemaVersion: 1, reportPlan: {
      schemaVersion: 1, baseSource: 'ledger', joins: [],
      scalars: [], tables: [malformed], texts: [],
    } });
    await expect(new CodexCliProvider('test').generateStructured({
      schema: ReportCalculationInferenceSchema, system: 's', user: 'u',
    })).resolves.toMatchObject({
      reportPlan: { tables: [{ id: 'summary', columns: [{ id: 'risk' }] }] },
    });
  });

  it('drops an extra compare delimiter before its missing right operand', async () => {
    const left = {
      kind: 'arithmetic', operation: 'divide',
      left: { kind: 'literal', value: 1 }, right: { kind: 'literal', value: 2 },
    };
    const valid = JSON.stringify({
      kind: 'aggregate', id: 'summary',
      groupBy: [{ id: 'region', value: { kind: 'field', path: 'region' } }],
      columns: [{
        id: 'risk',
        value: {
          kind: 'derived',
          expression: {
            kind: 'case',
            branches: [{
              when: { kind: 'compare', operation: 'lt', left, right: { kind: 'literal', value: 0.5 } },
              value: { kind: 'literal', value: 'risk' },
            }],
            fallback: { kind: 'literal', value: 'ok' },
          },
        },
      }],
    });
    const malformed = valid.replace(`"left":${JSON.stringify(left)},`, `"left":${JSON.stringify(left)}},`);
    respond({ schemaVersion: 1, reportPlan: {
      schemaVersion: 1, baseSource: 'ledger', joins: [],
      scalars: [], tables: [malformed], texts: [],
    } });
    await expect(new CodexCliProvider('test').generateStructured({
      schema: ReportCalculationInferenceSchema, system: 's', user: 'u',
    })).resolves.toMatchObject({
      reportPlan: { tables: [{ id: 'summary', columns: [{ id: 'risk' }] }] },
    });
  });

  it('drops a duplicated array closer in a grouped key before the next table property', async () => {
    const valid = JSON.stringify({
      kind: 'aggregate', id: 'summary',
      groupBy: [{ id: 'customer', value: {
        kind: 'concat', values: [
          { kind: 'field', path: 'customer_name' },
          { kind: 'literal', value: ' (' },
          { kind: 'field', path: 'customer_id' },
          { kind: 'literal', value: ')' },
        ],
      } }],
      columns: [{ id: 'customer', value: { kind: 'group_key', keyId: 'customer' } }],
    });
    const malformed = valid.replace('"value":")"}]}}],"columns"', '"value":")"}] }]}],"columns"');
    respond({ schemaVersion: 1, reportPlan: {
      schemaVersion: 1, baseSource: 'ledger', joins: [],
      scalars: [], tables: [malformed], texts: [],
    } });
    await expect(new CodexCliProvider('test').generateStructured({
      schema: ReportCalculationInferenceSchema, system: 's', user: 'u',
    })).resolves.toMatchObject({
      reportPlan: { tables: [{ id: 'summary', groupBy: [{ id: 'customer' }] }] },
    });
  });

  it('repairs a trailing comma when an encoded table object loses its final closer', async () => {
    const valid = JSON.stringify({
      kind: 'aggregate', id: 'summary',
      groupBy: [{ id: 'region', value: { kind: 'field', path: 'region' } }],
      columns: [{ id: 'count', value: { kind: 'aggregate', expression: { kind: 'count' } } }],
      sort: [{ columnId: 'count', direction: 'desc' }],
    });
    const malformed = `${valid.slice(0, -1)},`;
    respond({ schemaVersion: 1, reportPlan: {
      schemaVersion: 1, baseSource: 'ledger', joins: [],
      scalars: [], tables: [malformed], texts: [],
    } });
    await expect(new CodexCliProvider('test').generateStructured({
      schema: ReportCalculationInferenceSchema, system: 's', user: 'u',
    })).resolves.toMatchObject({
      reportPlan: { tables: [{ id: 'summary', sort: [{ columnId: 'count' }] }] },
    });
  });

  it('reassembles encoded table fragments only when they form complete JSON objects', async () => {
    const table = JSON.stringify({
      kind: 'aggregate', id: 'summary',
      groupBy: [{ id: 'region', value: { kind: 'field', path: 'region' } }],
      columns: [{ id: 'count', value: { kind: 'aggregate', expression: { kind: 'count' } } }],
      sort: [{ columnId: 'count', direction: 'desc' }],
    });
    const fragments = table.split(/(?<=,)/u);
    expect(fragments.length).toBeGreaterThan(1);
    respond({ schemaVersion: 1, reportPlan: {
      schemaVersion: 1, baseSource: 'ledger', joins: [],
      scalars: [], tables: fragments, texts: [],
    } });
    await expect(new CodexCliProvider('test').generateStructured({
      schema: ReportCalculationInferenceSchema, system: 's', user: 'u',
    })).resolves.toMatchObject({
      reportPlan: { tables: [{ id: 'summary', sort: [{ columnId: 'count' }] }] },
    });
  });

  it('repairs a missing property quote only at an encoded fragment boundary', async () => {
    const table = JSON.stringify({
      kind: 'aggregate', id: 'summary',
      groupBy: [{ id: 'region', value: { kind: 'field', path: 'region' } }],
      columns: [{ id: 'count', value: { kind: 'aggregate', expression: { kind: 'count' } } }],
      sort: [{ columnId: 'count', direction: 'desc' }],
    });
    const fragments = table.split(/(?<=,)/u).map((part, index) => (
      index > 0 ? part.replace(/^"/u, '') : part
    ));
    respond({ schemaVersion: 1, reportPlan: {
      schemaVersion: 1, baseSource: 'ledger', joins: [],
      scalars: [], tables: fragments, texts: [],
    } });
    await expect(new CodexCliProvider('test').generateStructured({
      schema: ReportCalculationInferenceSchema, system: 's', user: 'u',
    })).resolves.toMatchObject({
      reportPlan: { tables: [{ id: 'summary', sort: [{ columnId: 'count' }] }] },
    });
  });

  it('keeps a repairable malformed encoded item separate from the next item', async () => {
    const first = JSON.stringify({
      kind: 'aggregate', id: 'first',
      groupBy: [{ id: 'region', value: { kind: 'field', path: 'region' } }],
      columns: [{ id: 'count', value: { kind: 'aggregate', expression: { kind: 'count' } } }],
    });
    const malformed = first.slice(0, -1);
    const second = JSON.stringify({
      kind: 'aggregate', id: 'second',
      groupBy: [{ id: 'region', value: { kind: 'field', path: 'region' } }],
      columns: [{ id: 'count', value: { kind: 'aggregate', expression: { kind: 'count' } } }],
    });
    respond({ schemaVersion: 1, reportPlan: {
      schemaVersion: 1, baseSource: 'ledger', joins: [],
      scalars: [], tables: [malformed, second], texts: [],
    } });
    await expect(new CodexCliProvider('test').generateStructured({
      schema: ReportCalculationInferenceSchema, system: 's', user: 'u',
    })).resolves.toMatchObject({
      reportPlan: { tables: [{ id: 'first' }, { id: 'second' }] },
    });
  });

  it('restores unions nested inside an encoded union array item', async () => {
    const value = z.union([
      z.object({ kind: z.literal('table'), columns: z.array(z.object({
        value: z.union([z.object({ kind: z.literal('group_key'), keyId: z.string() }),
          z.object({ kind: z.literal('aggregate'), expression: z.string() })]),
      })) }),
      z.object({ kind: z.literal('view') }),
    ]);
    const encoded = JSON.stringify({ kind: 'table', columns: [
      { value: JSON.stringify({ kind: 'group_key', keyId: 'region' }) },
    ] });
    respond({ tables: [encoded] });
    await expect(new CodexCliProvider('test').generateStructured({
      schema: z.object({ tables: z.array(value) }), system: 's', user: 'u',
    })).resolves.toEqual({ tables: [{ kind: 'table', columns: [
      { value: { kind: 'group_key', keyId: 'region' } },
    ] }] });
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
