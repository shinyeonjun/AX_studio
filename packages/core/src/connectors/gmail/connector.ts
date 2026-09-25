import type { gmail_v1 } from 'googleapis';
import { ZodError } from 'zod';
import type { Connector, ConnectorContext, ConnectorResult } from '../types.js';
import { buildGmailRawMessage } from './mime.js';
import { extractGmailPlainBody } from './body-extract.js';
import { pollGmailNewMessages } from './new-message-poll/poll.js';
import { resolveGmailMessageId } from './message-id.js';
import { searchGmailMessagePage } from './search-page.js';

export interface GmailConnectorConfig {
  clientId: string;
  clientSecret?: string;
  refreshToken: string;
  accessToken?: string;
  expiryDate?: number;
  email?: string;
  onTokens?: (tokens: { refreshToken?: string; accessToken?: string; expiryDate?: number }) => void | Promise<void>;
}

export class GmailConnector implements Connector {
  name = 'gmail';
  private tokenWriteQueue: Promise<void> = Promise.resolve();

  constructor(private config: GmailConnectorConfig) {}

  private async getClient(signal?: AbortSignal): Promise<gmail_v1.Gmail> {
    const { google } = await import('googleapis');
    signal?.throwIfAborted();
    const oauth2 = new google.auth.OAuth2(this.config.clientId, this.config.clientSecret);
    oauth2.setCredentials({
      access_token: this.config.accessToken,
      refresh_token: this.config.refreshToken,
      expiry_date: this.config.expiryDate,
    });
    oauth2.on('tokens', (tokens) => {
      if (tokens.access_token) this.config.accessToken = tokens.access_token;
      if (tokens.expiry_date) this.config.expiryDate = tokens.expiry_date;
      if (tokens.refresh_token) this.config.refreshToken = tokens.refresh_token;
      if (this.config.onTokens) {
        const next = {
          refreshToken: this.config.refreshToken,
          ...(this.config.accessToken ? { accessToken: this.config.accessToken } : {}),
          ...(this.config.expiryDate ? { expiryDate: this.config.expiryDate } : {}),
        };
        this.tokenWriteQueue = this.tokenWriteQueue
          .then(() => this.config.onTokens!(next))
          .catch((error) => {
            console.error('[gmail] failed to persist rotated OAuth tokens:', error);
          });
      }
    });
    return google.gmail({ version: 'v1', auth: oauth2, timeout: 30_000, retry: false, signal });
  }

  async execute(action: string, params: Record<string, unknown>, ctx: ConnectorContext): Promise<ConnectorResult> {
    try {
      ctx.abortSignal?.throwIfAborted();
      switch (action) {
        case 'messages.read':
        case 'message.read': {
          const id = resolveGmailMessageId(params);
          if (!id) {
            return {
              ok: false,
              error: 'Gmail messageId가 필요합니다. 트리거 입력 또는 messages.read 바인딩을 확인하세요.',
              errorCode: 'gmail_message_id_missing',
            };
          }
          const gmail = await this.getClient(ctx.abortSignal);
          const res = await gmail.users.messages.get({ userId: 'me', id, format: 'full' });
          ctx.abortSignal?.throwIfAborted();
          const body = extractGmailPlainBody(res.data);
          return { ok: true, data: { ...res.data, body: body ?? res.data.snippet ?? '' } };
        }
        case 'messages.search':
        case 'message.search': {
          const gmail = await this.getClient(ctx.abortSignal);
          const page = await searchGmailMessagePage(gmail, params, ctx.abortSignal);
          return { ok: true, data: page };
        }
        case 'draft.create': {
          const to = typeof params.to === 'string' ? params.to.trim() : '';
          if (!to) {
            return { ok: false, error: 'to_required', errorCode: 'invalid_params' };
          }
          const body = typeof params.body === 'string' ? params.body : '';
          if (!body.trim()) {
            return { ok: false, error: 'body_required', errorCode: 'invalid_params' };
          }
          const raw = buildGmailRawMessage({
            to,
            // The catalog marks subject as optional. Preserve that contract
            // instead of inventing a reply subject when the user omitted it.
            subject: String(params.subject ?? ''),
            body,
          });
          const gmail = await this.getClient(ctx.abortSignal);
          const res = await gmail.users.drafts.create({ userId: 'me', requestBody: { message: { raw } } });
          return { ok: true, data: res.data };
        }
        case 'message.send': {
          const to = typeof params.to === 'string' ? params.to.trim() : '';
          if (!to) {
            return { ok: false, error: 'to_required', errorCode: 'invalid_params' };
          }
          const body = typeof params.body === 'string' ? params.body : '';
          if (!body.trim()) {
            return { ok: false, error: 'body_required', errorCode: 'invalid_params' };
          }
          const raw = buildGmailRawMessage({
            to,
            // The catalog marks subject as optional. Preserve that contract
            // instead of inventing a reply subject when the user omitted it.
            subject: String(params.subject ?? ''),
            body,
          });
          const gmail = await this.getClient(ctx.abortSignal);
          const res = await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
          return { ok: true, data: res.data };
        }
        case 'new_message.poll': {
          const gmail = await this.getClient(ctx.abortSignal);
          const poll = await pollGmailNewMessages(gmail, {
            initialized: Boolean(params.initialized),
            seenMessageIds: (params.seenMessageIds as string[]) ?? [],
            historyId: params.historyId as string | undefined,
          }, ctx.abortSignal);
          return { ok: true, data: poll };
        }
        default:
          return { ok: false, error: `Unknown gmail action: ${action}` };
      }
    } catch (err) {
      if (ctx.abortSignal?.aborted) return { ok: false, error: 'cancelled', errorCode: 'cancelled' };
      if (err instanceof ZodError) return { ok: false, error: 'invalid_search_params', errorCode: 'invalid_params' };
      const message = err instanceof Error ? err.message : 'Gmail request failed';
      return {
        ok: false,
        error: message.slice(0, 1000),
        errorCode: message.includes('invalid_grant') ? 'oauth_refresh_failed' : 'gmail_error',
      };
    }
  }
}
