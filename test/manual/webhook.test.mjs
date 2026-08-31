import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const helperPath = join(root, 'test/manual/webhook.mjs');
const body = JSON.stringify({ probe: 'manual-webhook-security' });
const secret = 'synthetic-test-secret';

function listen(server) {
  return new Promise((resolve, reject) => {
    const onError = (error) => reject(error);
    server.once('error', onError);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', onError);
      const address = server.address();
      assert(address && typeof address === 'object');
      resolve(address.port);
    });
  });
}

function close(server) {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

function runHelper(arguments_) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [helperPath, ...arguments_], {
      cwd: root,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
}

function helperArguments(url, auth, extra = []) {
  return [
    '--url', url,
    '--secret', secret,
    '--auth', auth,
    '--event-id', `event-${auth}`,
    '--repeat', '1',
    '--body', body,
    ...extra,
  ];
}

test('direct loopback delivery still supports shared-secret and HMAC authentication', async () => {
  const requests = [];
  const server = createServer(async (request, response) => {
    requests.push({
      headers: request.headers,
      method: request.method,
      url: request.url,
      body: await readBody(request),
    });
    response.writeHead(202, { 'content-type': 'text/plain' });
    response.end('accepted');
  });

  try {
    const port = await listen(server);
    for (const auth of ['secret', 'hmac']) {
      const result = await runHelper(helperArguments(
        `http://127.0.0.1:${port}/hooks/direct`,
        auth,
      ));
      assert.equal(result.code, 0, result.stderr);
      assert.match(result.stdout, /accepted/);
    }

    assert.equal(requests.length, 2);
    for (const request of requests) {
      assert.equal(request.method, 'POST');
      assert.equal(request.url, '/hooks/direct');
      assert.equal(request.body, body);
    }
    assert.equal(requests[0].headers['idempotency-key'], 'event-secret');
    assert.equal(requests[0].headers['x-ax-webhook-secret'], secret);
    assert.equal(requests[0].headers['x-ax-signature'], undefined);
    assert.equal(requests[1].headers['idempotency-key'], 'event-hmac');
    assert.equal(requests[1].headers['x-ax-webhook-secret'], undefined);
    assert.equal(
      requests[1].headers['x-ax-signature'],
      `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`,
    );
  } finally {
    await close(server);
  }
});

test('redirects fail closed without forwarding either authentication mode', async () => {
  let sourceRequests = 0;
  let destinationRequests = 0;
  const destination = createServer((request, response) => {
    destinationRequests += 1;
    request.resume();
    response.writeHead(202, { 'content-type': 'text/plain' });
    response.end('accepted');
  });
  let source;

  try {
    const destinationPort = await listen(destination);
    source = createServer((request, response) => {
      sourceRequests += 1;
      request.resume();
      const status = request.url?.endsWith('/302') ? 302 : 307;
      response.writeHead(status, {
        location: `http://127.0.0.1:${destinationPort}/outside-validated-origin`,
      });
      response.end();
    });
    const sourcePort = await listen(source);

    const attempts = [
      { auth: 'secret', status: 307 },
      { auth: 'hmac', status: 307 },
      { auth: 'secret', status: 302 },
    ];
    const results = [];
    for (const attempt of attempts) {
      results.push(await runHelper(helperArguments(
        `http://127.0.0.1:${sourcePort}/hooks/${attempt.status}`,
        attempt.auth,
      )));
    }

    assert.equal(sourceRequests, attempts.length);
    assert.equal(destinationRequests, 0);
    for (const [index, result] of results.entries()) {
      assert.equal(result.code, 1, result.stdout);
      assert.match(result.stderr, new RegExp(`HTTP ${attempts[index].status}`));
    }
  } finally {
    if (source) await close(source);
    await close(destination);
  }
});

test('--check performs no network request', async () => {
  let requests = 0;
  const server = createServer((request, response) => {
    requests += 1;
    request.resume();
    response.writeHead(500);
    response.end();
  });

  try {
    const port = await listen(server);
    const result = await runHelper([
      ...helperArguments(`http://127.0.0.1:${port}/hooks/check`, 'secret'),
      '--check',
    ]);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /helper OK/);
    assert.equal(requests, 0);
  } finally {
    await close(server);
  }
});
