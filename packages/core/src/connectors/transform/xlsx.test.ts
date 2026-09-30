import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as XLSX from 'xlsx';
import { ArtifactStore } from '../../persistence/artifact-store.js';
import { buildTableArtifact } from '../../contracts/artifacts/table-build.js';
import { materializeStepOutputs } from '../../runtime/output-ports.js';
import { TransformConnector } from './connector.js';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'ax-xlsx-')); roots.push(root);
  const store = new ArtifactStore(root);
  const table = buildTableArtifact({ id: 'previous', headers: ['id', 'text', 'paid', 'empty'],
    matrix: [[3, '=HYPERLINK("https://invalid")', true, null], [4, '+SUM(1,2)', false, null], [1, '@test', true, null]] });
  const ctx = { executionId: 'test', variables: {}, log: vi.fn(), artifactSink: store };
  return { store, table, ctx, connector: new TransformConnector() };
}
it('persists typed xlsx output with exact rows/order/types, literal strings, nulls and no physical path leak', async () => {
  const { store, table, ctx, connector } = fixture();
  const result = await connector.execute('table_to_xlsx', { table, path: '/ignored.xlsx' }, ctx);
  expect(result.ok).toBe(true);
  const output = materializeStepOutputs('export', { artifact: 'JsonArtifact' }, result.data) as { artifact: { value: { id: string } } };
  const stored = store.get(output.artifact.value.id)!;
  const workbook = XLSX.read(readFileSync(stored.storedPath), { type: 'buffer' });
  const sheet = workbook.Sheets.Data!;
  expect(XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null })).toEqual([
    ['id', 'text', 'paid', 'empty'], [3, '=HYPERLINK("https://invalid")', true, null], [4, '+SUM(1,2)', false, null], [1, '@test', true, null],
  ]);
  expect(sheet.B2).toMatchObject({ t: 's', v: '=HYPERLINK("https://invalid")' });
  expect(sheet.B2).not.toHaveProperty('f'); expect(sheet.B2).not.toHaveProperty('l');
  expect(JSON.stringify(result)).not.toContain(stored.storedPath);
  expect(JSON.stringify(ctx.log.mock.calls)).not.toContain('HYPERLINK');
  const repeated = await connector.execute('table_to_xlsx', { table }, ctx);
  expect(repeated).toEqual(result); // content-addressed host storage, no overwrite/duplicate
});
it('retains a partial-source warning in the workbook without exporting unrelated source paths', async () => {
  const { store, table, ctx, connector } = fixture();
  table.truncated = true; table.source = { filePath: '/private/source' };
  const result = await connector.execute('table_to_xlsx', { table }, ctx);
  const id = (result.data as { artifact: { value: { id: string } } }).artifact.value.id;
  const workbook = XLSX.read(readFileSync(store.get(id)!.storedPath), { type: 'buffer' });
  const info = JSON.stringify(XLSX.utils.sheet_to_json(workbook.Sheets['Export info']!, { header: 1 }));
  expect(info).toContain('partial'); expect(info).not.toContain('/private/source');
});
it('fails closed on invalid input, storage absence/failure and pre-cancel without logging success', async () => {
  const { table, ctx, connector } = fixture();
  expect(await connector.execute('table_to_xlsx', { table: 'invented' }, ctx)).toMatchObject({ ok: false, errorCode: 'table_input_invalid' });
  expect(await connector.execute('table_to_xlsx', { table }, { ...ctx, artifactSink: undefined })).toMatchObject({ ok: false, errorCode: 'xlsx_artifact_store_unavailable' });
  const putBytes = vi.fn(() => { throw new Error('private path'); });
  const failed = await connector.execute('table_to_xlsx', { table }, { ...ctx, artifactSink: { putBytes } });
  expect(failed).toMatchObject({ ok: false, errorCode: 'xlsx_artifact_store_failed' });
  expect(JSON.stringify(failed)).not.toContain('private path');
  const controller = new AbortController(); controller.abort();
  await expect(connector.execute('table_to_xlsx', { table }, { ...ctx, abortSignal: controller.signal })).rejects.toThrow();
  expect(ctx.log).not.toHaveBeenCalled();
});
it('rejects cell truncation, non-finite numbers, absent fields and duplicate columns', async () => {
  const { table, ctx, connector } = fixture();
  for (const value of ['x'.repeat(32_768), Infinity, undefined]) {
    const invalid = structuredClone(table); invalid.rows[0]!.values.text = value as string;
    expect((await connector.execute('table_to_xlsx', { table: invalid }, ctx)).ok).toBe(false);
  }
  table.columns.push(table.columns[0]!);
  expect((await connector.execute('table_to_xlsx', { table }, ctx)).ok).toBe(false);
  expect(ctx.log).not.toHaveBeenCalled();
});
