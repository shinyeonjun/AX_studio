import { IncomingMessage } from 'node:http';

import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebhookInboundListener } from '../../listener.js';
import { findFreePort } from '../../../../runtime/trigger-engine/push/fixtures.js';

const listeners: WebhookInboundListener[] = [];

afterEach(async () => {
  await Promise.all(listeners.map((listener) => listener.stop()));
  listeners.length = 0;
  vi.restoreAllMocks();
});

describe('WebhookInboundListener path and secret rejection', () => {
  it('rejects malformed URL encoding in webhook paths', async () => {
    const listener = new WebhookInboundListener();
    listeners.push(listener);
    const port = await findFreePort();

    await listener.start({ port, secret: 'hook-secret' }, () => undefined);
    const response = await fetch(`http://127.0.0.1:${port}/hooks/%E0%A4%A`, {
      method: 'POST',
      headers: { 'x-ax-webhook-secret': 'hook-secret' },
      body: '{}',
    });

    expect(response.status).toBe(400);
    expect(await response.text()).toBe('invalid_path');
  });

  it.each([
    { path: '/hooks/test', method: 'PUT', status: 405 },
    { path: '/unknown', method: 'POST', status: 404 },
    { path: '/hooks/%E0%A4%A', method: 'POST', status: 400 },
  ])('drains rejected $status request bodies', async ({ path, method, status }) => {
    const port = await findFreePort();
    const listener = new WebhookInboundListener();
    listeners.push(listener);
    const resume = vi.spyOn(IncomingMessage.prototype, 'resume');

    await listener.start({ port, secret: 'hook-secret' }, () => undefined);
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      body: 'rejected-body',
    });

    expect(response.status).toBe(status);
    expect(resume).toHaveBeenCalled();
  });

  it('rejects requests without valid secret', async () => {
    const listener = new WebhookInboundListener();
    listeners.push(listener);
    const port = await findFreePort();

    await listener.start({ port, secret: 'hook-secret' }, () => undefined);
    const response = await fetch(`http://127.0.0.1:${port}/hooks/test`, {
      method: 'POST',
      body: '{}',
    });
    expect(response.status).toBe(401);
  });

  it('backs off a client after repeated failed authentication attempts', async () => {
    const listener = new WebhookInboundListener();
    listeners.push(listener);
    const port = await findFreePort();
    await listener.start({ port, secret: 'hook-secret' }, () => undefined);
    const attempt = (secret: string) => fetch(`http://127.0.0.1:${port}/hooks/test`, {
      method: 'POST',
      headers: { 'x-ax-webhook-secret': secret },
      body: '{}',
    });

    for (let index = 0; index < 5; index += 1) {
      expect((await attempt('wrong')).status).toBe(401);
    }
    const blocked = await attempt('hook-secret');
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
  });

  it('rejects a stale timestamp in shared-secret mode', async () => {
    const listener = new WebhookInboundListener();
    listeners.push(listener);
    const port = await findFreePort();
    await listener.start({ port, secret: 'hook-secret' }, () => undefined);
    const stale = String(Math.floor(Date.now() / 1_000) - 3_600);
    const response = await fetch(`http://127.0.0.1:${port}/hooks/test`, {
      method: 'POST',
      headers: { 'x-ax-webhook-secret': 'hook-secret', 'x-ax-timestamp': stale },
      body: '{}',
    });
    expect(response.status).toBe(401);
  });
});
