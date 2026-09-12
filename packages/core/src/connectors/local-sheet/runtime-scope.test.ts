import { afterEach, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildConnectorsFromStore } from '../registry.js';
import { registerAllModules } from '../packages/register.js';
import { createDatabaseAsync } from '../../persistence/db.js';
import { WorkflowStore } from '../../persistence/workflow-store.js';
import { buildAxDataPaths, setAxDataPaths } from '../../persistence/paths/ax-data.js';
import type { ConnectorContext } from '../types.js';

const cleanup: Array<() => void> = [];
afterEach(() => { for (const dispose of cleanup.splice(0).reverse()) dispose(); setAxDataPaths(null); });

async function fixture() {
  registerAllModules();
  const root = mkdtempSync(join(tmpdir(), 'ax-sheet-scope-'));
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  const paths = buildAxDataPaths(join(root, 'profile'));
  setAxDataPaths(paths);
  const db = await createDatabaseAsync(':memory:');
  cleanup.push(() => db.close?.());
  const store = new WorkflowStore(db);
  const folder = join(root, 'connected');
  mkdirSync(folder);
  mkdirSync(paths.artifacts, { recursive: true });
  const outside = join(root, 'private.csv');
  writeFileSync(outside, 'secret\nnot-authorized\n');
  const reader = buildConnectorsFromStore(store).local_sheet!;
  expect(reader).toBeDefined();
  const context = (): ConnectorContext => ({ executionId: 'scope-fixture', variables: {}, log: () => {}, connections: store.getConnections() });
  return { root, store, folder, outside, paths, read: (path: string) => reader.execute('read', { path }, context()) };
}

it('registers a real sheet reader but refuses arbitrary unconnected paths', async () => {
  const f = await fixture();
  expect(await f.read(f.outside)).toMatchObject({ ok: false, errorCode: 'path_outside_source' });
});

it('reads current connected files and immediately respects removal of the source grant', async () => {
  const f = await fixture();
  const path = join(f.folder, 'sales.csv');
  writeFileSync(path, 'amount\n10\n20\n');
  f.store.setConnection('local_folder', true, { folders: [{ id: 'source', label: 'Sales', path: f.folder }] });
  expect(await f.read(path)).toMatchObject({ ok: true, data: { rows: [{ values: { amount: 10 } }, { values: { amount: 20 } }] } });
  expect(await f.read(f.outside)).toMatchObject({ ok: false, errorCode: 'path_outside_source' });
  f.store.setConnection('local_folder', false);
  expect(await f.read(path)).toMatchObject({ ok: false, errorCode: 'path_outside_source' });
});

it('allows imported sheets but rejects symlink escapes and non-sheet files', async () => {
  const f = await fixture();
  const imported = join(f.paths.artifacts, 'imported.csv');
  writeFileSync(imported, 'amount\n42\n');
  expect(await f.read(imported)).toMatchObject({ ok: true });
  const other = join(f.paths.artifacts, 'private.json');
  writeFileSync(other, '{"secret":"do-not-read"}');
  expect(await f.read(other)).toMatchObject({ ok: false, errorCode: 'path_outside_source' });
  const external = join(f.root, 'outside');
  mkdirSync(external);
  writeFileSync(join(external, 'private.csv'), 'secret\nprivate\n');
  symlinkSync(external, join(f.paths.artifacts, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
  expect(await f.read(join(f.paths.artifacts, 'escape', 'private.csv'))).toMatchObject({ ok: false, errorCode: 'path_outside_source' });
});
