import { describe, expect, it, afterEach } from 'vitest';
import { WebhookInboundListener } from './listener.js';

describe('WebhookInboundListener', () => {
  const listeners: WebhookInboundListener[] = [];

  afterEach(async () => {
    await Promise.all(listeners.map((listener) => listener.stop()));
    listeners.length = 0;
  });

  it('accepts signed POST and emits trigger event', async () => {
    const listener = new WebhookInboundListener();
    listeners.push(listener);
    const events: Array<{ type: string; payload: Record<string, unknown> }> = [];
    const port = 38_901;

    await listener.start({ port, secret: 'hook-secret' }, (event) => {
      events.push(event);
    });

    const response = await fetch(`http://127.0.0.1:${port}/hooks/invoice-paid`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-ax-webhook-secret': 'hook-secret',
      },
      body: '{"total":42}',
    });

    expect(response.status).toBe(202);
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('webhook.inbound');
    expect(events[0]?.payload.path).toBe('invoice-paid');
    expect(events[0]?.payload.body).toBe('{"total":42}');
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
