import { createServer, type Server } from 'node:http';
import type { WebhookEventHandler, WebhookListenerOptions } from './listener/contracts.js';
import { handleWebhookRequest } from './listener/handler.js';
import { WebhookAuthFailureLimiter, WebhookReplayCache } from './security.js';

const WEBHOOK_MAX_ACTIVE_REQUESTS = 64;
const WEBHOOK_REQUEST_TIMEOUT_MS = 15_000;
export type { WebhookEventHandler, WebhookListenerOptions } from './listener/contracts.js';

/** Why the port could not be opened, said so the person can fix it (shown in the connection form). */
function listenFailure(error: unknown, port: number): Error {
  const code = (error as { code?: unknown } | null)?.code;
  const message = code === 'EADDRINUSE'
    ? `포트 ${port}를 이미 다른 프로그램이 쓰고 있어요. 다른 포트 번호를 입력해 주세요.`
    : code === 'EACCES'
      ? `포트 ${port}를 열 권한이 없어요. 1024 이상의 다른 포트 번호를 입력해 주세요.`
      : undefined;
  return message ? Object.assign(new Error(message), { code, cause: error }) : error instanceof Error ? error : new Error(String(error));
}

export class WebhookInboundListener {
  private server?: Server;
  private controller?: AbortController;
  private transition: Promise<void> = Promise.resolve();
  private activeRequests = 0;

  start(options: WebhookListenerOptions, onEvent: WebhookEventHandler): Promise<void> {
    const operation = this.transition.catch(() => undefined).then(() => this.startListening(options, onEvent));
    this.transition = operation;
    return operation;
  }

  stop(): Promise<void> {
    const operation = this.transition.catch(() => undefined).then(() => this.stopListening());
    this.transition = operation;
    return operation;
  }

  private async startListening(options: WebhookListenerOptions, onEvent: WebhookEventHandler): Promise<void> {
    await this.stopListening();

    const host = options.host ?? '127.0.0.1';
    const controller = new AbortController();
    this.controller = controller;
    const replayCache = new WebhookReplayCache();
    const authLimiter = new WebhookAuthFailureLimiter();
    const server = createServer((req, res) => {
      if (this.activeRequests >= WEBHOOK_MAX_ACTIVE_REQUESTS) {
        res.statusCode = 503;
        res.end('overloaded');
        req.destroy();
        return;
      }
      this.activeRequests += 1;
      void handleWebhookRequest(req, res, options, onEvent, controller.signal, replayCache, authLimiter)
        .finally(() => { this.activeRequests -= 1; });
    });
    server.headersTimeout = 10_000;
    server.requestTimeout = WEBHOOK_REQUEST_TIMEOUT_MS;
    server.keepAliveTimeout = 5_000;
    server.maxConnections = WEBHOOK_MAX_ACTIVE_REQUESTS;
    this.server = server;

    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(options.port, host, () => {
          server.off('error', reject);
          resolve();
        });
      });
      // A server error after start (e.g. a socket-level failure) is logged, never an uncaught crash.
      server.on('error', (error) => console.warn('[webhook] server error:', error.message));
    } catch (error) {
      controller.abort();
      this.controller = undefined;
      this.server = undefined;
      throw listenFailure(error, options.port);
    }
  }

  private async stopListening(): Promise<void> {
    if (!this.server) return;
    const server = this.server;
    this.server = undefined;
    this.controller?.abort();
    this.controller = undefined;
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
      server.closeAllConnections();
    });
  }

  isRunning(): boolean {
    return Boolean(this.server?.listening);
  }
}
