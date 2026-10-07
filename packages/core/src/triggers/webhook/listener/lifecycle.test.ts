import { createServer } from 'node:http';

import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebhookInboundListener } from '../listener.js';

const listeners: WebhookInboundListener[] = [];

afterEach(async () => {
  await Promise.all(listeners.map((listener) => listener.stop()));
  listeners.length = 0;
  vi.restoreAllMocks();
});

describe('WebhookInboundListener lifecycle', () => {
  it('can restart after its port was initially unavailable', async () => {
    const blocker = createServer();
    await new Promise<void>((resolve) => blocker.listen(0, '127.0.0.1', resolve));
    const address = blocker.address();
    if (!address || typeof address === 'string') throw new Error('test_port_unavailable');

    const listener = new WebhookInboundListener();
    listeners.push(listener);
    await expect(listener.start({ port: address.port, secret: 'hook-secret' }, () => undefined)).rejects.toMatchObject({
      code: 'EADDRINUSE',
      message: `포트 ${address.port}를 이미 다른 프로그램이 쓰고 있어요. 다른 포트 번호를 입력해 주세요.`,
    });

    await new Promise<void>((resolve, reject) => blocker.close((error) => (error ? reject(error) : resolve())));
    await listener.start({ port: address.port, secret: 'hook-secret' }, () => undefined);

    expect(listener.isRunning()).toBe(true);
  });
});
