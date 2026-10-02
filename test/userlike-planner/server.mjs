import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

export const orders = [
  { id: 1, product: '노트', price: 5000, status: '결제완료' },
  { id: 2, product: '연필', price: 1000, status: '취소' },
  { id: 3, product: '지우개', price: 2000, status: '결제완료' },
  { id: 4, product: '파일', price: 3000, status: '배송중' },
];
export const products = [{ id: 1, name: '노트', price: 5000 }, { id: 2, name: '연필', price: 1000 }];
export const refunds = [{ id: 1, order_id: 2, amount: 1000, status: '완료' }];
export async function startLab(root) {
  mkdirSync(root, { recursive: true });
  const filePath = join(root, 'synthetic.sqlite');
  const db = new DatabaseSync(filePath);
  db.exec('CREATE TABLE orders(id INTEGER PRIMARY KEY, product TEXT, price INTEGER, status TEXT); CREATE TABLE products(id INTEGER PRIMARY KEY, name TEXT, price INTEGER); CREATE TABLE refunds(id INTEGER PRIMARY KEY, order_id INTEGER, amount INTEGER, status TEXT);');
  for (const [table, rows] of Object.entries({ orders, products, refunds })) {
    const insert = db.prepare(`INSERT INTO ${table} VALUES (${Object.keys(rows[0]).map(() => '?').join(',')})`);
    for (const row of rows) insert.run(...Object.values(row));
  }
  db.close();
  const outbox = [];
  let requests = 0;
  const server = createServer(async (req, res) => {
    requests++;
    const url = new URL(req.url, 'http://localhost');
    const send = (status, body) => { if (!res.destroyed) { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); } };
    if (url.pathname === '/failure') return send(503, { error: 'synthetic_unavailable' });
    if (url.pathname === '/delay') { await new Promise(resolve => setTimeout(resolve, 200)); return send(200, orders); }
    if (url.pathname === '/outbox' && req.method === 'POST') {
      let bytes = 0; for await (const chunk of req) { bytes += chunk.length; if (bytes > 4096) return send(413, {}); }
      outbox.push({ id: outbox.length + 1 }); return send(201, outbox.at(-1));
    }
    const rows = { '/orders': orders, '/products': products, '/refunds': refunds }[url.pathname];
    return send(rows ? 200 : 404, rows ?? { error: 'not_found' });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { filePath, baseUrl: `http://127.0.0.1:${server.address().port}`, outbox,
    get requests() { return requests; }, close: () => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }) };
}
