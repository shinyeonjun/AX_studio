import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebhookInboundListener } from '../../listener.js';

const listeners: WebhookInboundListener[] = [];

afterEach(async () => {
  await Promise.all(listeners.map((listener) => listener.stop()));
  listeners.length = 0;
  vi.restoreAllMocks();
});

describe('WebhookInboundListener acceptance', () => {
  it('preserves a provider idempotency key as the event request id across retries', async () => {
    const listener = new WebhookInboundListener();
    listeners.push(listener);
    const events: Array<{ payload: Record<string, unknown> }> = [];
    const port = 38_912;

    await listener.start({ port, secret: 'hook-secret' }, (event) => {
      events.push(event);
    });

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await fetch(`http://127.0.0.1:${port}/hooks/retryable`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': 'provider-event-42',
          'x-ax-webhook-secret': 'hook-secret',
        },
        body: '{"attempt":1}',
      });
      expect(response.status).toBe(202);
    }

    expect(events).toHaveLength(2);
    expect(events[0]?.payload.requestId).toBe('provider-event-42');
    expect(events[1]?.payload.requestId).toBe('provider-event-42');
  });

  it('keeps keyless webhook deliveries distinguishable', async () => {
    const listener = new WebhookInboundListener();
    listeners.push(listener);
    const events: Array<{ payload: Record<string, unknown> }> = [];
    const port = 38_913;

    await listener.start({ port, secret: 'hook-secret' }, (event) => {
      events.push(event);
    });

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await fetch(`http://127.0.0.1:${port}/hooks/keyless`, {
        method: 'POST',
        headers: { 'x-ax-webhook-secret': 'hook-secret' },
        body: '{}',
      });
      expect(response.status).toBe(202);
    }

    expect(events[0]?.payload.requestId).toEqual(expect.any(String));
    expect(events[1]?.payload.requestId).toEqual(expect.any(String));
    expect(events[0]?.payload.requestId).not.toBe(events[1]?.payload.requestId);
  });

  it('decodes URL-encoded webhook paths before emitting the event', async () => {
    const listener = new WebhookInboundListener();
    listeners.push(listener);
    const events: Array<{ payload: Record<string, unknown> }> = [];
    const port = 38_906;

    await listener.start({ port, secret: 'hook-secret' }, (event) => {
      events.push(event);
    });
    const response = await fetch(`http://127.0.0.1:${port}/hooks/${encodeURIComponent('결제 완료')}`, {
      method: 'POST',
      headers: { 'x-ax-webhook-secret': 'hook-secret' },
      body: '{}',
    });

    expect(response.status).toBe(202);
    expect(events[0]?.payload.path).toBe('결제 완료');
  });
});
