import { createServer } from 'node:http';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createAxStudioCore } from '../../packages/core/dist/index.js';
import { HttpConnector } from '../../packages/core/dist/connectors/http/connector.js';

export function deliveryWorkflow({ id = 'release-delivery', approval = false, failAfterSend = false, trigger } = {}) {
  return { id, name: '릴리즈 전송 검증', goal: '승인과 재시작에도 정확히 한 번 요청', version: 1, trigger,
    steps: [
      { type: 'action', id: 'send', connector: 'http', action: 'post', params: { path: '/deliver', body: { marker: id } }, sideEffect: 'EXTERNAL' },
      ...(failAfterSend ? [{ type: 'action', id: 'read', connector: 'http', action: 'request', params: { path: '/fail' }, sideEffect: 'NONE' }] : []),
    ], permissions: {}, approval: [], allowExternalAuto: !approval, assumptions: [], sideEffects: {}, dataPolicy: {} };
}

export async function openCore(dataRoot, baseUrl) {
  mkdirSync(join(dataRoot, 'data'), { recursive: true });
  const core = await createAxStudioCore({ dataRoot, recoverInterruptedExecutions: true });
  core.runtime.setConnector('http', new HttpConnector({ baseUrl, auth: { type: 'none' } }));
  return core;
}

export async function closeCore(core) {
  if (!core) return;
  core.scheduler.stop();
  core.runtime.stopAccepting();
  await core.triggerEngine.stop();
  await core.runtime.waitForIdle();
  await core.agentHarness.dispose();
  core.db.close?.();
}

export async function until(predicate, timeoutMs = 15_000) {
  const deadline = performance.now() + timeoutMs;
  while (!await predicate()) {
    if (performance.now() >= deadline) throw new Error('release_condition_timeout');
    await delay(20);
  }
}

export async function startHttpFixture({ hold = false } = {}) {
  const deliveries = [];
  const held = new Set();
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    if (request.method === 'POST' && request.url === '/deliver') {
      deliveries.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      if (hold) { held.add(response); return; }
    }
    response.writeHead(request.url === '/fail' ? 503 : 200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ ok: request.url !== '/fail', receipt: deliveries.length }));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    deliveries,
    release() { for (const response of held) response.end('{"ok":true}'); held.clear(); },
    async close() {
      for (const response of held) response.destroy();
      server.closeAllConnections();
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}
