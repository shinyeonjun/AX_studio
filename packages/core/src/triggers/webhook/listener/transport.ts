import type { IncomingMessage, ServerResponse } from 'node:http';

const PROVIDER_EVENT_ID_HEADERS = [
  'idempotency-key',
  'x-idempotency-key',
  'x-event-id',
  'x-webhook-id',
  'x-github-delivery',
] as const;

const SENSITIVE_REQUEST_HEADERS = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-ax-webhook-secret',
  'x-ax-signature',
  'x-api-key',
  'x-auth-token',
  'x-access-token',
]);

export function readRequestBody(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;
    req.on('data', (chunk: Buffer) => {
      if (settled) return;
      total += chunk.length;
      if (total > maxBytes) {
        settled = true;
        reject(new Error('payload_too_large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks));
    });
    req.on('error', (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
  });
}

export function requestHeaders(req: IncomingMessage): Record<string, string | string[] | undefined> {
  return req.headers;
}

export function providerEventId(req: IncomingMessage): string | undefined {
  for (const name of PROVIDER_EVENT_ID_HEADERS) {
    const value = req.headers[name];
    const candidate = Array.isArray(value) ? value[0] : value;
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  return undefined;
}

const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/**
 * Key used for failed-auth backoff. Direct clients are keyed by socket address.
 * Behind a local tunnel every request arrives from loopback, so use the last
 * X-Forwarded-For hop: the tunnel appends it, so the caller cannot choose it.
 * Headers the caller can set outright (cf-connecting-ip through a non-Cloudflare
 * tunnel, earlier XFF hops) would give every attempt a fresh budget.
 */
export function authClientKey(req: IncomingMessage): string {
  const remote = req.socket.remoteAddress ?? 'unknown';
  if (!LOOPBACK_ADDRESSES.has(remote)) return remote;
  const value = req.headers['x-forwarded-for'];
  const joined = Array.isArray(value) ? value.join(',') : value;
  const forwarded = joined?.split(',').pop()?.trim();
  return forwarded ? `${remote}|${forwarded.slice(0, 64)}` : remote;
}

export function forwardedHeaders(req: IncomingMessage): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (SENSITIVE_REQUEST_HEADERS.has(key.toLowerCase())) continue;
    if (typeof value === 'string') headers[key] = value;
    else if (Array.isArray(value)) headers[key] = value.join(',');
  }
  return headers;
}

export function respond(res: ServerResponse, status: number, body: string): void {
  res.statusCode = status;
  res.setHeader('content-type', 'text/plain; charset=utf-8');
  res.end(body);
}

export function rejectRequest(req: IncomingMessage, res: ServerResponse, status: number, body: string): void {
  respond(res, status, body);
  if (status === 413) {
    setImmediate(() => req.destroy());
  } else {
    req.resume();
  }
}
