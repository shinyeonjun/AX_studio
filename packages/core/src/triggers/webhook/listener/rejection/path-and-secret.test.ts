import { IncomingMessage } from 'node:http';

import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebhookInboundListener } from '../../listener.js';

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
    const port = 38_907;

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
    { port: 38_908, path: '/hooks/test', method: 'PUT', status: 405 },
    { port: 38_909, path: '/unknown', method: 'POST', status: 404 },
    { port: 38_910, path: '/hooks/%E0%A4%A', method: 'POST', status: 400 },
  ])('drains rejected $status request bodies', async ({ port, path, method, status }) => {
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
    const port = 38_902;

    await listener.start({ port, secret: 'hook-secret' }, () => undefined);
    const response = await fetch(`http://127.0.0.1:${port}/hooks/test`, {
      method: 'POST',
      body: '{}',
    });
    expect(response.status).toBe(401);
  });
});
