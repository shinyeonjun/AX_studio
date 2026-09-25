import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { TriggerEvent } from '../../types.js';
import {
  WEBHOOK_MAX_PAYLOAD_BYTES,
  WebhookReplayCache,
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
  abortSignal?: AbortSignal,
  replayCache?: WebhookReplayCache,
): Promise<void> {
  try {
    if (abortSignal?.aborted) return;
    if (req.method !== 'POST') {
      rejectRequest(req, res, 405, 'method_not_allowed');
      return;
    }

    // Validate the original path before WHATWG URL removes dot segments or
    // normalizes backslashes into separators and changes the selected hook.
    try {
      const rawPath = decodeURIComponent((req.url ?? '/').split('?', 1)[0]!);
      if (rawPath.includes('\\')) throw new Error('invalid_path');
      normalizeWebhookPath(rawPath);
    } catch {
      rejectRequest(req, res, 400, 'invalid_path');
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
    if (abortSignal?.aborted) return;
    const requestId = providerEventId(req) ?? randomUUID();
    const timestamp = typeof req.headers['x-ax-timestamp'] === 'string' ? req.headers['x-ax-timestamp'] : undefined;
    const signature = typeof req.headers['x-ax-signature'] === 'string' ? req.headers['x-ax-signature'] : undefined;
    if (signature && (!timestamp || !providerEventId(req))) {
      respond(res, 401, 'unauthorized');
      return;
    }
    if (!verifyWebhookAuth(requestHeaders(req), options.secret, rawBody, signature ? {
      method: req.method,
      path,
      eventId: requestId,
      timestamp: timestamp!,
    } : undefined)) {
      respond(res, 401, 'unauthorized');
      return;
    }

    const replayKey = signature && replayCache ? `${requestId}:${signature}` : undefined;
    if (replayKey && !replayCache!.claim(replayKey)) {
      respond(res, 409, 'replayed_request');
      return;
    }

    // Prefer a provider's stable event key so retries can be deduplicated.
    // Keyless callers still receive a unique local request id.
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

    let accepted: boolean | void;
    try {
      accepted = await onEvent(event);
    } catch (error) {
      if (replayKey) replayCache!.release(replayKey);
      console.error('[webhook] event handler failed:', error);
      rejectRequest(req, res, 503, 'temporarily_unavailable');
      return;
    }
    if (accepted === false) {
      if (replayKey) replayCache!.release(replayKey);
      rejectRequest(req, res, 503, 'temporarily_unavailable');
      return;
    }
    respond(res, 202, 'accepted');
  } catch (err) {
    if (abortSignal?.aborted || res.destroyed) return;
    if ((err as Error).message === 'payload_too_large') {
      rejectRequest(req, res, 413, 'payload_too_large');
      return;
    }
    rejectRequest(req, res, 500, 'internal_error');
  }
}
