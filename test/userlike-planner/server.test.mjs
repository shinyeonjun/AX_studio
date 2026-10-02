import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startLab } from './server.mjs';
import { RdbConnector } from '../../packages/core/dist/connectors/rdb/index.js';
import { HttpConnector } from '../../packages/core/dist/connectors/http/index.js';

test('production SQLite and localhost HTTP connectors: rows, repeat, failure, cancellation, fake outbox', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ax-userlike-'));
  const lab = await startLab(root);
  const ctx = { executionId: 'synthetic', variables: {}, log() {} };
  try {
    const rdb = new RdbConnector({ type: 'sqlite', filePath: lab.filePath, allowedTables: ['orders', 'products', 'refunds'], rowLimit: 100 });
    const query = await rdb.execute('query.read', { table: 'orders' }, ctx);
    assert.equal(query.ok, true); assert.deepEqual(query.data.rows.map(r => r.values.id), [1,2,3,4]);
    const repeated = await rdb.execute('query.read', { table: 'orders' }, ctx);
    assert.equal(repeated.ok, true); assert.deepEqual(repeated.data.rows, query.data.rows);
    const http = new HttpConnector({ id: 'lab', baseUrl: lab.baseUrl, auth: { type: 'none' } });
    const response = await http.execute('request', { path: '/products' }, ctx);
    assert.equal(response.ok, true);
    assert.equal((await http.execute('request', { path: '/failure' }, ctx)).ok, false);
    const controller = new AbortController();
    const delayed = http.execute('request', { path: '/delay' }, { ...ctx, abortSignal: controller.signal });
    controller.abort();
    const cancelled = await delayed.catch(() => ({ ok: false })); assert.equal(cancelled.ok, false);
    assert.equal((await http.execute('post', { path: '/outbox', body: { synthetic: true } }, ctx)).ok, true);
    assert.equal(lab.outbox.length, 1);
    assert.equal((await http.execute('request', { path: '/refunds' }, ctx)).ok, true);
  } finally { await lab.close(); rmSync(root, { recursive: true, force: true }); }
});
