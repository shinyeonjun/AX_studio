import { createServer, type Server } from 'node:http';
import type { WebhookEventHandler, WebhookListenerOptions } from './listener/contracts.js';
import { handleWebhookRequest } from './listener/handler.js';
export type { WebhookEventHandler, WebhookListenerOptions } from './listener/contracts.js';

export class WebhookInboundListener {
  private server?: Server;

  async start(options: WebhookListenerOptions, onEvent: WebhookEventHandler): Promise<void> {
    await this.stop();

    const host = options.host ?? '127.0.0.1';
    this.server = createServer((req, res) => {
      void handleWebhookRequest(req, res, options, onEvent);
    });

    try {
      await new Promise<void>((resolve, reject) => {
        this.server!.once('error', reject);
        this.server!.listen(options.port, host, () => resolve());
      });
    } catch (error) {
      this.server = undefined;
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    const server = this.server;
    this.server = undefined;
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }

  isRunning(): boolean {
    return Boolean(this.server?.listening);
  }
}
