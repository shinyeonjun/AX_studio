// Local REST fixture for manual AX Studio testing.
// No external network access: everything lives in this process's memory.
//
// Endpoints:
//   GET  /health          -> { ok: true }
//   GET  /items           -> { items: [...] }
//   GET  /items/:id       -> item | 404
//   POST /items (JSON)    -> created item (201)
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

const DEFAULT_PORT = Number(process.env.AX_MANUAL_REST_PORT || 4820);

function seedItems() {
  return [
    { id: 'item-1', name: '월간 보고서 발송', status: 'done', amount: 125000 },
    { id: 'item-2', name: '고객 목록 동기화', status: 'pending', amount: 98000 },
    { id: 'item-3', name: '재고 알림', status: 'pending', amount: 43000 },
  ];
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) reject(new Error('payload too large'));
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error('invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

export function startRestFixture({ port = DEFAULT_PORT, log = console.log } = {}) {
  const items = seedItems();
  let nextId = items.length + 1;

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    const send = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(body));
    };

    try {
      if (req.method === 'GET' && url.pathname === '/health') {
        return send(200, { ok: true, service: 'ax-manual-rest', time: new Date().toISOString() });
      }
      if (req.method === 'GET' && url.pathname === '/items') {
        return send(200, { items });
      }
      const itemMatch = url.pathname.match(/^\/items\/([\w-]+)$/);
      if (req.method === 'GET' && itemMatch) {
        const item = items.find((entry) => entry.id === itemMatch[1]);
        return item ? send(200, item) : send(404, { error: 'not_found' });
      }
      if (req.method === 'POST' && url.pathname === '/items') {
        const body = await readJsonBody(req);
        if (!body || typeof body !== 'object' || typeof body.name !== 'string' || !body.name.trim()) {
          return send(400, { error: 'name_required' });
        }
        const item = {
          id: `item-${nextId++}`,
          name: body.name.trim(),
          status: typeof body.status === 'string' ? body.status : 'pending',
          amount: typeof body.amount === 'number' ? body.amount : 0,
          createdAt: new Date().toISOString(),
        };
        items.push(item);
        log(`[rest] POST /items -> ${item.id} (${item.name})`);
        return send(201, item);
      }
      return send(404, { error: 'not_found' });
    } catch (err) {
      return send(400, { error: err instanceof Error ? err.message : String(err) });
    }
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const baseUrl = `http://127.0.0.1:${port}`;
      log(`[rest] listening: ${baseUrl}`);
      log(`[rest]   GET  ${baseUrl}/health`);
      log(`[rest]   GET  ${baseUrl}/items`);
      log(`[rest]   POST ${baseUrl}/items  (JSON: { "name": "...", "amount": 123 })`);
      resolve({
        baseUrl,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const fixture = await startRestFixture({});
  const shutdown = async () => {
    console.log('\n[rest] shutting down');
    await fixture.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  console.log('[rest] Ctrl+C 로 종료합니다.');
}
