/** Local synthetic diagnostics. No providers, services, or user databases. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { getEventListeners } from 'node:events';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync,
  readdirSync, renameSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const outputPath = resolve(process.argv[2] ?? 'resource-lifecycle-metrics.json');
const iterations = Number(process.argv[3] ?? 180);
assert(Number.isSafeInteger(iterations) && iterations >= 12 && iterations <= 3000);
mkdirSync(dirname(outputPath), { recursive: true });
const directory = mkdtempSync(join(dirname(outputPath), 'ax-resource-stress-'));
process.env.AX_DB_BACKEND = 'sqljs';
process.env.AX_DATA_ROOT = directory;
process.env.AX_DOCUMENT_ARTIFACT_ROOT = directory;
process.env.AX_TEMPLATE_ROOT = directory;
const { requestDocumentEngine } = await import('../packages/core/dist/documents/read/engine-client/stdio/request.js');
const { commandProcesses } = await import('../packages/core/dist/intelligence/agent/model/cli-process/runner/ownership.js');
const { readRdbRows } = await import('../packages/core/dist/connectors/rdb/client/rows.js');
const { listRdbTables } = await import('../packages/core/dist/connectors/rdb/client/catalog.js');
const { describeRdbTable } = await import('../packages/core/dist/connectors/rdb/client/describe.js');
const { createDatabaseAsync, openReadonlySqlite } = await import('../packages/core/dist/persistence/db.js');
const { WorkflowStore } = await import('../packages/core/dist/persistence/workflow-store.js');
const { WorkflowRuntime } = await import('../packages/core/dist/runtime/engine.js');
// Node >=22.18 can strip the erasable types in this standalone host helper.
const { fetchTextWithTimeout } = await import('../apps/desktop/electron/main/fetch-timeout.ts');

const workerScript = join(directory, 'synthetic-worker.mjs');
writeFileSync(workerScript, `
import { writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  const { params } = JSON.parse(input);
  const hold = ['timeout', 'cancel', 'tree_cancel'].includes(params.mode);
  const descendant = params.mode === 'tree_cancel'
    ? spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { windowsHide: true, stdio: 'ignore' }) : undefined;
  writeFileSync(params.marker, JSON.stringify({ pid: process.pid, descendantPid: descendant?.pid }));
  if (hold) { setInterval(() => {}, 1000); return; }
  if (params.mode === 'invalid') { process.stdout.write('synthetic invalid JSON'); return; }
  process.stdout.write(JSON.stringify({ ok: true, data: { engine: 'synthetic-node', payload: 'a'.repeat(262144) } }));
  if (params.mode === 'nonzero') process.exitCode = 7;
});
`, 'utf8');

const metrics = {
  schemaVersion: 2, startedAt: new Date().toISOString(), platform: process.platform,
  node: process.version, iterations, gcAvailable: typeof global.gc === 'function',
  scope: 'Generic document subprocess transport, mocked-fetch WebStreams, sql.js fixture and empty local workflows; not Python/PDF/Electron UI',
  directory, cases: {}, workerCalls: 0, pidsChecked: 0, descendantsChecked: 0,
  sourceSha256: Object.fromEntries([
    'scripts/resource-lifecycle-stress.mjs',
    'apps/desktop/electron/main/fetch-timeout.ts',
    'packages/core/dist/intelligence/agent/model/cli-process/runner/stream.js',
    'packages/core/dist/intelligence/agent/model/cli-process/runner/ownership.js',
    'packages/core/dist/documents/read/engine-client/stdio/request.js',
    'packages/core/dist/runtime/engine.js',
    'packages/core/dist/persistence/workflow-store.js',
  ].map(path => [path, createHash('sha256').update(readFileSync(new URL('../' + path, import.meta.url))).digest('hex')])),
  survivors: [], abortListenersAfterCalls: 0, maxOwnedChildrenAfterCalls: 0,
  sqlite: { backend: 'sqljs', operations: 0, directOpens: 0, directCloses: 0, renameChecks: 0 },
  fetchBodies: { operations: 0, successes: 0, oversized: 0, cancelled: 0, lockedAfterCalls: 0, abortListenersAfterCalls: 0 },
  runtime: { runs: 0, successes: 0, cancellations: 0 }, samples: [],
  savedWorkflows: { createDeleteCycles: 0, recreatedCycles: 0, lateActiveCancellations: 0, blockedOldSnapshots: 0 },
  deletionProbe: [], failures: [], cleanup: {},
};
const activeChildren = Reflect.get(commandProcesses, 'active');
const pause = ms => new Promise(resolvePause => setTimeout(resolvePause, ms));
function isAlive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { if (error.code === 'ESRCH') return false; throw error; }
}
async function snapshot(label, completed) {
  await pause(30);
  global.gc?.();
  await new Promise(resolveTurn => setImmediate(resolveTurn));
  const resources = {};
  for (const name of process.getActiveResourcesInfo()) resources[name] = (resources[name] ?? 0) + 1;
  const sample = { label, completed, ...process.memoryUsage(), ownedChildren: activeChildren.size, resources };
  metrics.samples.push(sample);
  return sample;
}

let callNumber = 0;
async function runWorker(mode, record = true) {
  const marker = join(directory, `worker-${callNumber++}.json`);
  const controller = new AbortController();
  const timeoutMs = mode === 'timeout' ? 500 : 5000;
  const pending = requestDocumentEngine({ pythonPath: process.execPath, workerScript,
    workerCwd: directory, artifactRoot: directory, timeoutMs, abortSignal: controller.signal },
  'synthetic', { mode, marker }).then(value => ({ value }), error => ({ error }));
  if (mode === 'cancel' || mode === 'tree_cancel') {
    const deadline = Date.now() + 3000;
    while (!existsSync(marker) && Date.now() < deadline && activeChildren.size > 0) await pause(5);
    controller.abort();
  }
  const result = await pending;
  if (record) { metrics.workerCalls++; metrics.cases[mode] = (metrics.cases[mode] ?? 0) + 1; }
  assert.equal(activeChildren.size, 0, `owned children remain after ${mode}`);
  metrics.maxOwnedChildrenAfterCalls = Math.max(metrics.maxOwnedChildrenAfterCalls, activeChildren.size);
  const listeners = getEventListeners(controller.signal, 'abort').length;
  metrics.abortListenersAfterCalls += listeners;
  assert.equal(listeners, 0);
  assert(existsSync(marker), `fixture did not start: ${mode}, ${result.error?.code ?? result.error?.message}`);
  const identity = JSON.parse(readFileSync(marker, 'utf8'));
  for (const [key, pid] of Object.entries(identity)) {
    if (!Number.isInteger(pid)) continue;
    metrics.pidsChecked++;
    if (key === 'descendantPid') metrics.descendantsChecked++;
    const deadline = Date.now() + 1000;
    while (isAlive(pid) && Date.now() < deadline) await pause(5);
    if (isAlive(pid)) metrics.survivors.push({ mode, key, pid });
    assert.equal(isAlive(pid), false, `owned fixture ${key} survived ${mode}`);
  }
  unlinkSync(marker);
  if (mode === 'success') assert.equal(result.value?.data?.engine, 'synthetic-node');
  else if (mode === 'nonzero') assert.match(result.error?.message ?? '', /document_engine_exit_7/);
  else if (mode === 'invalid') assert.match(result.error?.message ?? '', /document_engine_invalid_json/);
  else assert.equal(result.error?.code, mode === 'timeout' ? 'ETIMEDOUT' : 'ABORT_ERR');
}

let db;
const originalFetch = globalThis.fetch;
try {
  // Warm modules and OS paths before comparing retained memory.
  for (let index = 0; index < 12; index++) await runWorker(['success', 'nonzero', 'invalid', 'cancel'][index % 4], false);
  await snapshot('workers-warmed', 0);
  for (let index = 0; index < iterations; index++) {
    const mode = ['success', 'nonzero', 'invalid', 'timeout', 'cancel', 'tree_cancel'][index % 6];
    await runWorker(mode);
    // The next request must work after each failed or cancelled request.
    if (mode !== 'success') await runWorker('success');
    if ((index + 1) % 30 === 0 || index + 1 === iterations) await snapshot('workers', index + 1);
  }

  let response;
  let fetchSignal;
  globalThis.fetch = async (_input, init) => { fetchSignal = init.signal; return response; };
  response = new Response('synthetic warmup');
  await fetchTextWithTimeout('https://fixture.invalid');
  await snapshot('fetch-warmed', 0);
  for (let index = 0; index < 240; index++) {
    const mode = ['success', 'oversized', 'cancel'][index % 3];
    const controller = new AbortController();
    response = mode === 'success' ? new Response('a'.repeat(65536))
      : new Response(new ReadableStream(), mode === 'oversized' ? { headers: { 'content-length': '1048577' } } : {});
    let timer;
    try {
      const pending = fetchTextWithTimeout('https://fixture.invalid', { signal: controller.signal }, 1000);
      if (mode === 'success') { assert.equal((await pending).text.length, 65536); metrics.fetchBodies.successes++; }
      else if (mode === 'oversized') { await assert.rejects(pending); metrics.fetchBodies.oversized++; }
      else {
        timer = setTimeout(() => controller.abort(new Error('synthetic_body_cancelled')), 2);
        await assert.rejects(pending, /synthetic_body_cancelled/);
        metrics.fetchBodies.cancelled++;
      }
    } finally { clearTimeout(timer); }
    metrics.fetchBodies.operations++;
    metrics.fetchBodies.lockedAfterCalls += Number(response.body.locked);
    metrics.fetchBodies.abortListenersAfterCalls += getEventListeners(fetchSignal, 'abort').length;
    assert.equal(response.body.locked, false);
    assert.equal(getEventListeners(fetchSignal, 'abort').length, 0);
    if ((index + 1) % 60 === 0) await snapshot('fetch', index + 1);
  }
  response = undefined; fetchSignal = undefined;
  globalThis.fetch = originalFetch;

  const sqlitePath = join(directory, 'synthetic.sqlite');
  const seed = new DatabaseSync(sqlitePath);
  try { seed.exec('CREATE TABLE items (id INTEGER PRIMARY KEY, value TEXT); INSERT INTO items VALUES (1, \'synthetic\');'); }
  finally { seed.close(); }
  const config = { type: 'sqlite', filePath: sqlitePath, allowedTables: ['items', 'missing'] };
  await readRdbRows(config, { table: 'items' }, 5);
  await snapshot('sqlite-warmed', 0);
  for (let index = 0; index < 240; index++) {
    if (index % 5 === 0) await assert.rejects(readRdbRows(config, { table: 'missing' }, 5));
    else if (index % 5 === 1) await assert.rejects(readRdbRows(config, { table: 'items' }, 5, AbortSignal.abort()));
    else if (index % 5 === 2) assert.equal((await listRdbTables(config))[0].table, 'items');
    else if (index % 5 === 3) assert.equal((await describeRdbTable(config, { table: 'items' }))[0].name, 'id');
    else assert.equal((await readRdbRows(config, { table: 'items' }, 5))[0].value, 'synthetic');
    metrics.sqlite.operations++;
    const adapter = await openReadonlySqlite(sqlitePath);
    metrics.sqlite.directOpens++;
    try { assert.equal(adapter.all('SELECT COUNT(*) AS n FROM items')[0].n, 1); }
    finally { adapter.close(); metrics.sqlite.directCloses++; }
    const moved = `${sqlitePath}.closed`;
    renameSync(sqlitePath, moved);
    renameSync(moved, sqlitePath);
    metrics.sqlite.renameChecks++;
    if ((index + 1) % 60 === 0) await snapshot('sqlite', index + 1);
  }
  unlinkSync(sqlitePath);

  db = await createDatabaseAsync(':memory:');
  const runtimeConfig = { store: new WorkflowStore(db), globalActive: true, workflowActive: {} };
  const runtime = new WorkflowRuntime(runtimeConfig);
  const workflow = { name: 'Synthetic runtime', goal: 'Local lifecycle measurement', version: 1,
    inputs: [], steps: [], permissions: {}, approval: [], allowExternalAuto: false,
    assumptions: [], sideEffects: {}, dataPolicy: {} };
  const signal = new AbortController().signal;
  await snapshot('runtime-warmed', 0);
  for (let index = 0; index < 240; index++) {
    const cancel = index % 3 === 0;
    const result = await runtime.executeWorkflow(workflow, { ephemeral: true, abortSignal: cancel ? AbortSignal.abort() : signal });
    assert.equal(result.status, cancel ? 'cancelled' : 'success');
    metrics.runtime.runs++;
    if (cancel) metrics.runtime.cancellations++;
    else metrics.runtime.successes++;
    assert.equal(getEventListeners(signal, 'abort').length, 0);
    assert.equal(Reflect.get(runtime, 'activeExecutionCount'), 0);
    assert.equal(Reflect.get(runtime, 'activeWorkflowRuns').size, 0);
    assert.equal(Reflect.get(runtime, 'workflowIdleWaiters').size, 0);
    assert.equal(Reflect.get(runtime, 'idleWaiters').length, 0);
    if ((index + 1) % 60 === 0) await snapshot('runtime', index + 1);
  }
  await runtime.waitForIdle();

  const store = runtimeConfig.store;
  async function removeSaved(workflowId) {
    assert.equal(store.claimWorkflowDeletion(workflowId, store.getWorkflow(workflowId).version), true);
    try { await runtime.removeWorkflow(workflowId); assert.equal(store.deleteWorkflow(workflowId), true); }
    finally { store.releaseWorkflowDeletion(workflowId); }
  }
  async function assertRemoved(snapshot) {
    await assert.rejects(runtime.executeWorkflow(snapshot, { forceManual: true }), { code: 'workflow_removed' });
    await assert.rejects(runtime.executeWorkflow(snapshot, { ephemeral: true, forceManual: true }), { code: 'workflow_removed' });
    assert.throws(() => runtime.enqueueEphemeralWorkflow(snapshot), { code: 'workflow_removed' });
    metrics.savedWorkflows.blockedOldSnapshots++;
  }
  function assertSavedOwnersReleased() {
    assert.equal(Object.keys(runtimeConfig.workflowActive).length, 0);
    assert.equal(Reflect.get(store, 'workflowGenerations').size, 0);
    assert.equal(Reflect.get(store, 'deletingWorkflowIds').size, 0);
    assert.equal(Reflect.get(runtime, 'activeWorkflowRuns').size, 0);
    assert.equal(Reflect.get(runtime, 'workflowIdleWaiters').size, 0);
  }
  // Real rows exercise deletion retirement; no bounded historical-ID cache.
  for (let index = 0; index < 12; index++) {
    store.saveWorkflow({ ...workflow, id: 'synthetic-delete-warmup' });
    await removeSaved('synthetic-delete-warmup');
  }
  await snapshot('saved-workflows-warmed', 0);
  let earliest;
  for (let index = 0; index < 3000; index++) {
    const id = `synthetic-removed-${index}`;
    store.saveWorkflow({ ...workflow, id });
    if (index === 0) earliest = store.getWorkflow(id);
    store.setWorkflowActive(id, true); runtime.setWorkflowActive(id, true);
    await removeSaved(id);
    metrics.savedWorkflows.createDeleteCycles++;
    assertSavedOwnersReleased();
    if ([500, 1000, 2000, 3000].includes(index + 1)) {
      const sample = await snapshot('saved-workflows-deleted', index + 1);
      metrics.deletionProbe.push({ removals: index + 1,
        workflowActiveEntries: Object.keys(runtimeConfig.workflowActive).length,
        currentGenerationEntries: Reflect.get(store, 'workflowGenerations').size,
        deletionClaims: Reflect.get(store, 'deletingWorkflowIds').size,
        activeWorkflowEntries: Reflect.get(runtime, 'activeWorkflowRuns').size,
        heapUsed: sample.heapUsed, rss: sample.rss });
    }
  }
  await assertRemoved(earliest);
  for (let index = 0; index < 60; index++) {
    const id = 'synthetic-recreated-id';
    store.saveWorkflow({ ...workflow, id });
    const old = store.getWorkflow(id);
    await removeSaved(id);
    store.saveWorkflow({ ...workflow, id });
    store.setWorkflowActive(id, true); runtime.setWorkflowActive(id, true);
    await assertRemoved(old);
    assert.equal((await runtime.executeWorkflow(store.getWorkflow(id), { forceManual: true })).status, 'success');
    await removeSaved(id); assertSavedOwnersReleased();
    metrics.savedWorkflows.recreatedCycles++;
  }
  for (let index = 0; index < 40; index++) {
    const id = 'synthetic-late-active';
    let entered; let release;
    const started = new Promise(resolveEntered => { entered = resolveEntered; });
    const held = new Promise(resolveRelease => { release = resolveRelease; });
    runtime.setConnector('gmail', { name: 'synthetic', execute: async () => {
      entered(); await held; return { ok: true, data: [] };
    } });
    store.saveWorkflow({ ...workflow, id, steps: [{ type: 'action', id: 'read', connector: 'gmail',
      action: 'messages.search', params: { query: 'synthetic' }, sideEffect: 'NONE' }] });
    const old = store.getWorkflow(id);
    const run = runtime.executeWorkflow(old, { forceManual: true, abortSignal: signal });
    await started;
    const removal = removeSaved(id);
    release(); await removal;
    assert.equal((await run).status, 'cancelled');
    assert.equal(getEventListeners(signal, 'abort').length, 0);
    await assertRemoved(old); assertSavedOwnersReleased();
    metrics.savedWorkflows.lateActiveCancellations++;
  }
  runtime.setConnector('gmail', null);
  await snapshot('saved-workflows-recreated-and-cancelled', 3100);
  metrics.runtime.remainingActiveExecutions = Reflect.get(runtime, 'activeExecutionCount');
  metrics.runtime.remainingQueuedExecutions = Reflect.get(runtime, 'queuedExecutionCount');
  db.close(); db = undefined;
  await snapshot('all-closed', iterations);
} catch (error) {
  metrics.failures.push({ name: error.name, code: error.code, message: error.message });
  process.exitCode = 1;
} finally {
  globalThis.fetch = originalFetch;
  db?.close();
  metrics.cleanup.ownedChildren = activeChildren.size;
  // Remove only files in the exact temporary directory this run created.
  if (activeChildren.size === 0) {
    for (const name of readdirSync(directory)) {
      const path = join(directory, name);
      assert(lstatSync(path).isFile(), 'unexpected diagnostic entry; preserve it for review');
      unlinkSync(path);
    }
    rmdirSync(directory);
  }
  await snapshot('after-diagnostic-scope', iterations);
  metrics.cleanup.directoryRemoved = !existsSync(directory);
  metrics.finishedAt = new Date().toISOString();
  writeFileSync(outputPath, JSON.stringify(metrics, null, 2) + '\n');
  console.log(JSON.stringify({ outputPath, workerCalls: metrics.workerCalls, failures: metrics.failures.length,
    directoryRemoved: metrics.cleanup.directoryRemoved, ownedChildren: metrics.cleanup.ownedChildren }));
}
