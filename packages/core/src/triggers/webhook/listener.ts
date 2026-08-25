import type { IncomingMessage, ServerResponse } from 'node:http';
import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { TriggerEvent } from '../types.js';
import {
  WEBHOOK_MAX_PAYLOAD_BYTES,
  normalizeWebhookPath,
  verifyWebhookAuth,
} from './security.js';

export interface WebhookListenerOptions {
  port: number;
  secret: string;
  host?: string;
}

export type WebhookEventHandler = (event: TriggerEvent) => void;

function readRequestBody(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error('payload_too_large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function headerRecord(req: IncomingMessage): Record<string, string | string[] | undefined> {
  return req.headers;
}

function respond(res: ServerResponse, status: number, body: string): void {
  res.statusCode = status;
  res.setHeader('content-type', 'text/plain; charset=utf-8');
  res.end(body);
}

export class WebhookInboundListener {
  private server?: Server;

  async start(options: WebhookListenerOptions, onEvent: WebhookEventHandler): Promise<void> {
    await this.stop();

    const host = options.host ?? '127.0.0.1';
    this.server = createServer((req, res) => {
      void this.handleRequest(req, res, options, onEvent);
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

  private async handleRequest(
    req: IncomingMessage,
    res: ServerResponse,
    options: WebhookListenerOptions,
    onEvent: WebhookEventHandler,
  ): Promise<void> {
    try {
      if (req.method !== 'POST') {
        respond(res, 405, 'method_not_allowed');
        return;
      }

      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);
      const prefix = '/hooks/';
      if (!url.pathname.startsWith(prefix)) {
        respond(res, 404, 'not_found');
        return;
      }

      const pathSegment = url.pathname.slice(prefix.length);
      let path: string;
      try {
        path = normalizeWebhookPath(pathSegment);
      } catch {
        respond(res, 400, 'invalid_path');
        return;
      }

      const rawBody = await readRequestBody(req, WEBHOOK_MAX_PAYLOAD_BYTES);
      if (!verifyWebhookAuth(headerRecord(req), options.secret, rawBody)) {
        respond(res, 401, 'unauthorized');
        return;
      }

      const requestId = randomUUID();
      const receivedAt = new Date().toISOString();
      const body = rawBody.toString('utf8');
      const headers: Record<string, string> = {};
      for (const [key, value] of Object.entries(req.headers)) {
        if (typeof value === 'string') headers[key] = value;
        else if (Array.isArray(value)) headers[key] = value.join(',');
      }

      onEvent({
        type: 'webhook.inbound',
        payload: {
          path,
          body,
          headers,
          requestId,
          receivedAt,
        },
      });

      respond(res, 202, 'accepted');
    } catch (err) {
      if ((err as Error).message === 'payload_too_large') {
        respond(res, 413, 'payload_too_large');
        return;
      }
      respond(res, 500, 'internal_error');
    }
  }
}
