import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import initSqlJs from 'sql.js';
import Database from 'better-sqlite3';
import { RdbConnector } from './connector.js';
import { assertSafeRdbScalars, prepareRdbRows } from './client/scalars.js';
import { TableArtifactSchema } from '../../contracts/artifacts/table.js';
import { tableArtifactFromRows } from '../../contracts/artifacts/table-build.js';
import { captureReportSources } from '../../documents/reporting/source/capture.js';

const period = { start: '2026-09-01', endInclusive: '2026-09-30', label: 'September' };
const context = () => ({ executionId: 'rdb-contract-test', variables: {}, log: vi.fn() });

describe('RDB bounded read contract', () => {
  let directory: string;
  let filePath: string;
  beforeAll(async () => {
    directory = mkdtempSync(join(tmpdir(), 'ax-rdb-contract-'));
    filePath = join(directory, 'fixture.sqlite');
    const SQL = await initSqlJs();
    const db = new SQL.Database();
    db.run(`
      CREATE TABLE facts(id INTEGER PRIMARY KEY, identifier TEXT, text_value TEXT, amount INTEGER);
      INSERT INTO facts VALUES(1,'001','  padded  ',10),(2,'002','',20),(3,'003',NULL,30);
      CREATE TABLE empty_facts(id INTEGER PRIMARY KEY);
      CREATE TABLE unsafe_text(value TEXT);
      INSERT INTO unsafe_text VALUES('9007199254740993');
      CREATE TABLE unsafe_integer(value INTEGER);
      INSERT INTO unsafe_integer VALUES(9007199254740993);
      CREATE TABLE duplicate_values(amount INTEGER);
      WITH RECURSIVE n(i) AS (VALUES(1) UNION ALL SELECT i+1 FROM n WHERE i<5)
        INSERT INTO duplicate_values SELECT 1 FROM n;
      CREATE TABLE mutable(id INTEGER PRIMARY KEY);
      INSERT INTO mutable VALUES(1),(2),(3),(4),(5);
    `);
    writeFileSync(filePath, Buffer.from(db.export()));
    db.close();
  });
  afterAll(() => { if (directory) rmSync(directory, { recursive: true, force: true }); });

  function connector(table = 'facts', rowLimit = 2) {
    return new RdbConnector({ type: 'sqlite', filePath, allowedTables: [table], rowLimit });
  }

  it('keeps the legacy page fields but never labels a last page as whole-source coverage', async () => {
    const result = await connector().execute('query.read', { table: 'facts', offset: 2 }, context());
    expect(result).toMatchObject({ ok: true, data: {
      offset: 2, truncated: false, rows: [{ values: { id: 3 } }],
      completeness: { status: 'complete', observedCount: 1, hasMore: false },
      readScope: { schemaVersion: 1, kind: 'page', offset: 2, limit: 2, pagination: 'offset',
        predicate: 'none', projection: 'all_columns', scalarPolicy: 'preserve' },
      coverage: { page: 'complete', query: 'partial', source: 'partial', observedRows: 1,
        hasMore: false, consistency: 'best_effort', reason: 'independent_offset_reads' },
    } });
    const parsed = TableArtifactSchema.parse(result.data);
    expect(parsed.readScope?.queryFingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it('does not turn a single exhausted statement or empty result into verified snapshot coverage', async () => {
    const result = await connector('empty_facts').execute('query.read', { table: 'empty_facts' }, context());
    expect(result).toMatchObject({ ok: true, data: {
      rows: [], completeness: { status: 'complete', observedCount: 0, hasMore: false },
      coverage: { page: 'complete', query: 'unknown', source: 'unknown', observedRows: 0,
        consistency: 'best_effort', hasMore: false },
    } });
  });

  it('preserves DB scalar strings and raw values without changing shared legacy coercion', async () => {
    const result = await connector().execute('query.read', { table: 'facts' }, context());
    const table = TableArtifactSchema.parse(result.data);
    expect(table.rows[0]).toMatchObject({
      values: { id: 1, identifier: '001', text_value: '  padded  ', amount: 10 },
      rawValues: { id: 1, identifier: '001', text_value: '  padded  ', amount: 10 },
    });
    expect(table.rows[1].values.text_value).toBe('');
    expect(table.columns.find(column => column.name === 'identifier')?.type).toBe('string');
    expect(tableArtifactFromRows([{ identifier: '001' }], { id: 'legacy' })?.rows[0].values.identifier).toBe(1);
    expect(() => JSON.stringify(result)).not.toThrow();
  });

  it.each(['unsafe_text', 'unsafe_integer'])('refuses unsafe integral %s intake instead of rounding it', async table => {
    const ctx = context();
    const result = await connector(table).execute('query.read', { table }, ctx);
    expect(result).toEqual({ ok: false, error: 'rdb_unsafe_integer', errorCode: 'unsafe_precision' });
    expect(ctx.variables).not.toHaveProperty('queryResult');
    expect(JSON.stringify(result)).not.toContain('900719925474099');
  });

  it('cannot grant capture privileges or assert coverage from caller-supplied fields', async () => {
    const result = await connector().execute('query.read', { table: 'facts', limit: 100,
      reportCapture: true, readScope: { kind: 'whole_query' },
      coverage: { source: 'complete', consistency: 'verified_snapshot' },
      sql: 'DELETE FROM facts', columns: ['id'], where: { id: 3 },
    }, context());
    expect(result).toMatchObject({ ok: true, data: {
      rows: [{ values: { id: 1, amount: 10 } }, { values: { id: 2 } }], nextOffset: 2,
      readScope: { kind: 'page', limit: 2, predicate: 'none', projection: 'all_columns' },
      coverage: { source: 'partial', consistency: 'best_effort' },
    } });
  });

  it('uses one query identity across offsets, scoped to source and permission configuration', async () => {
    const read = connector();
    const first = TableArtifactSchema.parse((await read.execute('query.read', { table: 'facts' }, context())).data);
    const second = TableArtifactSchema.parse((await read.execute('query.read', { table: 'facts', offset: 2 }, context())).data);
    expect(first.readScope?.queryFingerprint).toBe(second.readScope?.queryFingerprint);
    const otherPermissions = new RdbConnector({ type: 'sqlite', filePath,
      allowedTables: ['facts', 'empty_facts'], rowLimit: 2 });
    const other = TableArtifactSchema.parse((await otherPermissions.execute('query.read', { table: 'facts' }, context())).data);
    expect(first.readScope?.queryFingerprint).not.toBe(other.readScope?.queryFingerprint);
    expect(JSON.stringify(first.readScope)).not.toContain(filePath);
  });

  it('preserves raw DB capture inputs and exposes unknown source coverage to callers', async () => {
    const read = connector();
    const snapshot = await captureReportSources({ schemaVersion: 1, http: [], rdb: [{ alias: 'facts', table: 'facts' }] },
      period, { executeHttp: vi.fn(), executeRdb: params => read.execute('query.read', params, context()) });
    expect(snapshot.facts).toMatchObject({ complete: true,
      rows: [{ identifier: '001', text_value: '  padded  ' }, { identifier: '002', text_value: '' }, { identifier: '003', text_value: null }],
      coverage: { schemaVersion: 1, scope: 'whole_query', transport: 'complete', query: 'unknown', source: 'unknown',
        consistency: 'best_effort', observedRows: 3, pagesRead: 2, periodFilterApplied: false },
      provenance: { consistency: 'unverified', requestedPeriod: period },
    });
  });

  it('keeps equal-page detection until a verified traversal cursor exists', async () => {
    const read = connector('duplicate_values');
    await expect(captureReportSources({ schemaVersion: 1, http: [], rdb: [{ alias: 'facts', table: 'duplicate_values' }] },
      period, { executeHttp: vi.fn(), executeRdb: params => read.execute('query.read', params, context()) }))
      .rejects.toThrow('report_rdb_pagination_no_progress:facts');
  });

  it('cannot claim whole-source completeness from nonidentical overlapping live pages', async () => {
    const writer = new Database(filePath);
    const read = connector('mutable');
    let calls = 0;
    try {
      const snapshot = await captureReportSources({ schemaVersion: 1, http: [], rdb: [{ alias: 'facts', table: 'mutable' }] },
        period, { executeHttp: vi.fn(), executeRdb: async params => {
          const result = await read.execute('query.read', params, context());
          if (calls++ === 0) writer.exec('INSERT INTO mutable VALUES(0)');
          return result;
        } });
      expect(snapshot.facts.rows.map(row => row.id)).toEqual([1, 2, 2, 3, 4, 5]);
      expect(snapshot.facts.coverage).toMatchObject({ transport: 'complete', query: 'unknown', source: 'unknown',
        consistency: 'best_effort', reason: 'independent_offset_reads' });
    } finally {
      writer.close();
    }
  });

  it('preserves the byte budget and returns no exact/partial snapshot on exhaustion', async () => {
    const read = connector();
    await expect(captureReportSources({ schemaVersion: 1, http: [], rdb: [{ alias: 'facts', table: 'facts' }] },
      period, { executeHttp: vi.fn(), executeRdb: params => read.execute('query.read', params, context()) }, { maxBytes: 1 }))
      .rejects.toThrow('report_capture_byte_limit');
  });

  it('does not allow the new contract to bypass the existing OFFSET and table allowlists', async () => {
    expect(await connector().execute('query.read', { table: 'facts', offset: 1_000_001 }, context()))
      .toMatchObject({ ok: false, error: 'invalid_row_pagination', errorCode: 'invalid_params' });
    expect(await connector().execute('query.read', { table: 'unsafe_text' }, context()))
      .toMatchObject({ ok: false, error: 'table_not_allowed', errorCode: 'policy_denied' });
  });

  it('rejects inconsistent page identity rather than silently exhausting the wrong offset', async () => {
    const read = connector();
    const executeRdb = vi.fn(async params => {
      const result = await read.execute('query.read', params, context());
      const table = TableArtifactSchema.parse(result.data);
      return { ...result, data: { ...table, readScope: { ...table.readScope, offset: 99 } } };
    });
    await expect(captureReportSources({ schemaVersion: 1, http: [], rdb: [{ alias: 'facts', table: 'facts' }] },
      period, { executeHttp: vi.fn(), executeRdb })).rejects.toThrow('report_rdb_read_contract_invalid:facts');
    expect(executeRdb).toHaveBeenCalledTimes(1);
  });

  it('rejects a changed query identity within one capture', async () => {
    const read = connector();
    const executeRdb = vi.fn(async params => {
      const result = await read.execute('query.read', params, context());
      const table = TableArtifactSchema.parse(result.data);
      if (Number(params.offset) > 0) {
        table.readScope!.queryFingerprint = 'f'.repeat(64);
        table.source!.queryFingerprint = 'f'.repeat(64);
      }
      return { ...result, data: table };
    });
    await expect(captureReportSources({ schemaVersion: 1, http: [], rdb: [{ alias: 'facts', table: 'facts' }] },
      period, { executeHttp: vi.fn(), executeRdb })).rejects.toThrow('report_rdb_read_contract_invalid:facts');
    expect(executeRdb).toHaveBeenCalledTimes(2);
  });

  it('rejects unsafe legacy raw data before report capture can consume normalized values', async () => {
    const table = tableArtifactFromRows([{ id: '9007199254740993' }], { id: 'legacy', preserveRawValues: true });
    await expect(captureReportSources({ schemaVersion: 1, http: [], rdb: [{ alias: 'facts', table: 'facts' }] },
      period, { executeHttp: vi.fn(), executeRdb: async () => ({ ok: true, data: table }) }))
      .rejects.toThrow('rdb_unsafe_integer');
  });
});

describe('RDB scalar precision guard', () => {
  it.each(['9007199254740992', '-9007199254740993', '+9007199254740993', '9,007,199,254,740,993',
    '9007199254740993.00', 9007199254740992, 9007199254740993n])('refuses unsafe value %s', value => {
    expect(() => assertSafeRdbScalars([{ value }])).toThrow('rdb_unsafe_integer');
  });
  it('keeps safe boundaries, decimal text, date-only values and timezone instants JSON-compatible', () => {
    const row = { boundary: '9007199254740991', negative: '-9007199254740991', padded: ' 001 ',
      decimal: '-12.30', null_value: null, date: '2026-09-30', malformed: '12x',
      instant: new Date('2026-09-30T01:00:00+09:00'), bigint: 12n };
    const [prepared] = prepareRdbRows([row]);
    expect(prepared).toEqual({ ...row, instant: '2026-09-29T16:00:00.000Z', bigint: '12' });
    expect(() => JSON.stringify(prepared)).not.toThrow();
  });
  it.each([Number.POSITIVE_INFINITY, Number.NaN])('refuses non-finite provider numbers %s', value => {
    expect(() => assertSafeRdbScalars([{ value }])).toThrow('rdb_non_finite_number');
  });
});
