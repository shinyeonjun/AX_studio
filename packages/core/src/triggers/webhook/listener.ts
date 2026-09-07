import { createServer, type Server } from 'node:http';
import type { WebhookEventHandler, WebhookListenerOptions } from './listener/contracts.js';
import { handleWebhookRequest } from './listener/handler.js';
export type { WebhookEventHandler, WebhookListenerOptions } from './listener/contracts.js';

export class WebhookInboundListener {
  private server?: Server;
  private controller?: AbortController;
  private transition: Promise<void> = Promise.resolve();

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
    const server = createServer((req, res) => {
      void handleWebhookRequest(req, res, options, onEvent, controller.signal);
    });
    this.server = server;

    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(options.port, host, () => resolve());
      });
    } catch (error) {
      controller.abort();
      this.controller = undefined;
      this.server = undefined;
      throw error;
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
