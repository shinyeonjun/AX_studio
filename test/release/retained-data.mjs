import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { assertRunner } from './runner-safety.mjs';
import { fileInventory } from './verify-assets.mjs';

const { values } = parseArgs({ options: { workspace: { type: 'string' }, snapshot: { type: 'boolean' }, compare: { type: 'boolean' } } });
try {
  assert(values.workspace && Boolean(values.snapshot) !== Boolean(values.compare), 'Choose snapshot or compare');
  const context = assertRunner({ paths: [values.workspace] });
  assert.equal(values.workspace, context.acceptance, 'Retention must use this owned acceptance workspace');
  const inventory = fileInventory(join(values.workspace, 'app-data'));
  for (const file of ['data/ax-studio.db', 'config/ai.toml', 'config/migration.json', 'credentials/secret-OPENAI_API_KEY.cred']) {
    assert(inventory[file], 'Missing retention fixture: ' + file);
  }
  assert(Object.keys(inventory).some(file => file.startsWith('generated/reports/') && file.endsWith('.pdf')));
  const checkpoint = join(values.workspace, 'uninstall-retention.json');
  if (values.snapshot) writeFileSync(checkpoint, JSON.stringify(inventory, null, 2), { flag: 'wx' });
  else assert.deepEqual(inventory, JSON.parse(readFileSync(checkpoint, 'utf8')), 'Uninstall changed synthetic data bytes or file inventory');
  console.log('[retention] PASS: complete synthetic data inventory and byte hashes');
} catch (error) { console.error(error.message); process.exitCode = 1; }
