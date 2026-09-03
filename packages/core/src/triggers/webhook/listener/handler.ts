import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { TriggerEvent } from '../../types.js';
import {
  WEBHOOK_MAX_PAYLOAD_BYTES,
  normalizeWebhookPath,
  verifyWebhookAuth,
} from '../security.js';
import type { WebhookEventHandler, WebhookListenerOptions } from './contracts.js';
import {
  forwardedHeaders,
  providerEventId,
  readRequestBody,
  rejectRequest,
  requestHeaders,
  respond,
} from './transport.js';

export async function handleWebhookRequest(
  req: IncomingMessage,
  res: ServerResponse,
  options: WebhookListenerOptions,
  onEvent: WebhookEventHandler,
): Promise<void> {
  try {
    if (req.method !== 'POST') {
      rejectRequest(req, res, 405, 'method_not_allowed');
      return;
    }

    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const prefix = '/hooks/';
    if (!url.pathname.startsWith(prefix)) {
      rejectRequest(req, res, 404, 'not_found');
      return;
    }

    const pathSegment = url.pathname.slice(prefix.length);
    let path: string;
    try {
      path = normalizeWebhookPath(decodeURIComponent(pathSegment));
    } catch {
      rejectRequest(req, res, 400, 'invalid_path');
      return;
    }

    const contentLength = Number(req.headers['content-length']);
    if (Number.isFinite(contentLength) && contentLength > WEBHOOK_MAX_PAYLOAD_BYTES) {
      rejectRequest(req, res, 413, 'payload_too_large');
      return;
    }

    const rawBody = await readRequestBody(req, WEBHOOK_MAX_PAYLOAD_BYTES);
    if (!verifyWebhookAuth(requestHeaders(req), options.secret, rawBody)) {
      respond(res, 401, 'unauthorized');
      return;
    }

    // Prefer a provider's stable event key so retries can be deduplicated.
    // Keyless callers still receive a unique local request id.
    const requestId = providerEventId(req) ?? randomUUID();
    const receivedAt = new Date().toISOString();
    const body = rawBody.toString('utf8');
    const event: TriggerEvent = {
      type: 'webhook.inbound',
      payload: {
        path,
        body,
        headers: forwardedHeaders(req),
        requestId,
        receivedAt,
      },
    };

    onEvent(event);
    respond(res, 202, 'accepted');
  } catch (err) {
    if ((err as Error).message === 'payload_too_large') {
      rejectRequest(req, res, 413, 'payload_too_large');
      return;
    }
    rejectRequest(req, res, 500, 'internal_error');
  }
}
