import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { JevDecisionEngine } from '../../packages/core/src/intelligence/decision/jev.js';
import { performHttpRequest } from '../../packages/core/src/connectors/http/request/execute.js';
import { createDatabaseAsync, openReadonlySqlite } from '../../packages/core/src/persistence/db/runtime.js';
import { fetchTextWithTimeout, fetchWithTimeout } from '../../apps/desktop/electron/main/fetch-timeout.js';

const require = createRequire(import.meta.url);
const versions = process.versions;
function floor(actual, minimum) {
  assert.match(actual ?? '', /^\d+\.\d+\.\d+$/);
  const a = actual.split('.').map(Number), b = minimum.split('.').map(Number);
  assert.equal(a[0], b[0], 'a new runtime major needs review');
  assert.ok(a[1] > b[1] || (a[1] === b[1] && a[2] >= b[2]), `${actual} < ${minimum}`);
}

test('actual binary matches the npm pin and embedded Node/Undici floors', () => {
  assert.equal(versions.electron, process.env.AX_ELECTRON_RUNTIME_EXPECTED);
  floor(versions.electron, '44.5.1');
  floor(versions.node, '24.21.0');
  floor(versions.undici, '7.29.1');
  assert.equal(typeof globalThis.fetch, 'function');
  console.log('AX_ELECTRON_RUNTIME ' + JSON.stringify({
    electron: versions.electron, chrome: versions.chrome, node: versions.node,
    undici: versions.undici, modules: versions.modules, napi: versions.napi,
    npmUndici: require('undici/package.json').version,
  }));
});

let base, jevMode = 'valid', landingHits = 0;
const requests = [];
const server = createServer(async (req, res) => {
  if (req.url === '/no-headers') return;
  if (req.url === '/hang') { res.writeHead(200); res.write('start'); return; }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks).toString('utf8');
  requests.push({ path: req.url, method: req.method, headers: req.headers, body });
  if (req.url === '/redirect') { res.writeHead(302, { location: `${base}/landing` }); res.end(); return; }
  if (req.url === '/landing') landingHits++;
  if (req.url === '/oversize') { res.writeHead(200); res.write('abcd'); res.end('efgh'); return; }
  if (req.url === '/v1/systemone') {
    if (jevMode === 'hang') { res.writeHead(200); res.write('{'); return; }
    res.setHeader('content-type', 'application/json');
    const answers = Object.fromEntries(Object.keys(JSON.parse(body).questions).map(
      id => [id, { type: 'noul', noul: jevMode === 'invalid' ? 2 : 0.87 }],
    ));
    res.end(JSON.stringify({ model: 'synthetic-jev', answers })); return;
  }
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ body, method: req.method }));
});
before(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  const closed = new Promise(resolve => server.close(resolve));
  server.closeAllConnections();
  await closed;
});
const question = { state: { text: '합성 café' }, questions: { relevant: { type: 'boolean', instructions: 'Relevant?' } } };
const engine = options => new JevDecisionEngine({ apiKey: 'synthetic-token', baseURL: base, ...options });

test('Jev uses built-in fetch and preserves synthetic wire bytes/headers/schema', async () => {
  const result = await engine().evaluate(question);
  assert.deepEqual(result.answers.relevant, { type: 'boolean', probability: 0.87 });
  assert.equal(result.providerRequestCount, 1);
  const request = requests.at(-1);
  assert.equal(request.path, '/v1/systemone');
  assert.equal(request.method, 'POST');
  assert.equal(request.headers.authorization, 'Bearer synthetic-token');
  assert.equal(request.headers['content-type'], 'application/json');
  assert.equal(request.body, JSON.stringify({ model: 'jev-latest', state: question.state,
    questions: { relevant: { type: 'noul', instructions: 'Relevant?' } } }));
  assert.equal(result.requestBytes, Buffer.byteLength(request.body));
});

test('Jev rejects invalid/oversized data and cancels a stalled real response', async () => {
  jevMode = 'invalid';
  await assert.rejects(engine().evaluate(question), /expected Jev schema/);
  const count = requests.length;
  await assert.rejects(engine({ maxRequestBytes: 32 }).evaluate(question), /too large/);
  assert.equal(requests.length, count);
  jevMode = 'valid';
  await assert.rejects(engine({ maxResponseBytes: 16 }).evaluate(question), /too large/);
  jevMode = 'hang';
  await assert.rejects(engine({ timeoutMs: 150 }).evaluate(question), /timed out/);
  const caller = new AbortController(), reason = new Error('synthetic caller cancellation');
  const pending = engine({ timeoutMs: 3_000 }).evaluate({ ...question, signal: caller.signal });
  const assertion = assert.rejects(pending, error => error === reason);
  setTimeout(() => caller.abort(reason), 50);
  await assertion;
  jevMode = 'valid';
});

test('HTTP connector preserves auth, manual redirects, body bounds and private guards', async () => {
  const response = await performHttpRequest({ url: `${base}/echo`, method: 'POST', body: '합성-body',
    headers: { Authorization: 'wrong' }, auth: { type: 'bearer', token: 'synthetic-token' } });
  assert.equal(response.ok, true);
  assert.equal(requests.at(-1).headers.authorization, 'Bearer synthetic-token');
  assert.equal(requests.at(-1).body, '합성-body');
  assert.equal((await performHttpRequest({ url: `${base}/redirect`, method: 'GET' })).errorCode, 'ssrf_blocked');
  assert.equal(landingHits, 0);
  const bounded = await performHttpRequest({ url: `${base}/oversize`, method: 'GET', maxBytes: 4 });
  assert.equal(bounded.ok, true); assert.equal(bounded.truncated, true); assert.equal(bounded.body, 'abcd');
  assert.equal((await performHttpRequest({ url: `${base}/echo`, method: 'GET', rejectPrivateDestination: true })).errorCode, 'ssrf_blocked');
});

test('HTTP connector distinguishes deadline and caller cancellation on real fetch', async () => {
  assert.equal((await performHttpRequest({ url: `${base}/hang`, method: 'GET', timeoutMs: 150 })).errorCode, 'timeout');
  const caller = new AbortController();
  const pending = performHttpRequest({ url: `${base}/hang`, method: 'GET', abortSignal: caller.signal });
  setTimeout(() => caller.abort(), 50);
  assert.equal((await pending).errorCode, 'aborted');
});

test('Desktop fetch helpers retain real body deadline and caller cancellation', async () => {
  assert.equal((await fetchTextWithTimeout(`${base}/echo`)).response.status, 200);
  await assert.rejects(fetchTextWithTimeout(`${base}/hang`, {}, 150), /요청 시간이 초과/);
  const caller = new AbortController(), reason = new Error('synthetic helper cancellation');
  const pending = fetchWithTimeout(`${base}/no-headers`, { signal: caller.signal }, 3_000);
  const assertion = assert.rejects(pending, error => error === reason);
  setTimeout(() => caller.abort(reason), 50);
  await assertion;
});

test('actual Electron loads both native SQLite bindings and persists native/sql.js databases', async () => {
  const bindings = [];
  for (const workspace of ['packages/core', 'apps/desktop']) {
    let native = 'available';
    const module = require.resolve('better-sqlite3', { paths: [join(process.env.AX_ELECTRON_RUNTIME_ROOT, workspace)] });
    try { const db = new (require(module))(':memory:'); db.prepare('SELECT 1').get(); db.close(); }
    catch (error) {
      assert.match(error.message, /bindings file|different Node\.js version|self-register/);
      native = /different Node\.js version|self-register/.test(error.message) ? 'ABI-incompatible' : 'not-installed';
    }
    bindings.push({ workspace, native });
    assert.equal(native, 'available', `${workspace}: verify the native binding before accepting this update`);
  }
  console.log('AX_NATIVE_SQLITE ' + JSON.stringify({ modules: versions.modules, bindings }));
  for (const backend of ['native', 'sqljs']) {
    if (backend === 'sqljs') process.env.AX_DB_BACKEND = 'sqljs';
    try {
      const path = join(process.env.AX_ELECTRON_RUNTIME_SCRATCH, `${backend}.db`);
      const db = await createDatabaseAsync(path);
      db.exec('CREATE TABLE electron_control (value TEXT NOT NULL)');
      db.prepare('INSERT INTO electron_control(value) VALUES (?)').run('합성 café');
      assert.equal(db.prepare('SELECT value FROM electron_control').get().value, '합성 café');
      db.close();
      const reopened = await openReadonlySqlite(path);
      assert.equal(reopened.all('SELECT value FROM electron_control')[0].value, '합성 café');
      reopened.close();
    } finally { delete process.env.AX_DB_BACKEND; }
  }
});
