import { isMessageToolField } from '../../contracts/tool-result.js';
import type { gmail_v1 } from '@googleapis/gmail';
import { ZodError } from 'zod';
import type { Connector, ConnectorContext, ConnectorResult } from '../types.js';
import { buildGmailRawMessage } from './mime.js';
import { extractGmailPlainBody, gmailHeaderLines } from './body-extract.js';
import { pollGmailNewMessages } from './new-message-poll/poll.js';
import { resolveGmailMessageId } from './message-id.js';
import { searchGmailMessagePage } from './search-page.js';
import { messageToolDraft, validGmailRecipient, type MessageToolDraft, type MessageSendBinding } from '../../contracts/tool-result.js';

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

  async prepareMessageSend(draft: MessageToolDraft): Promise<MessageSendBinding> {
    if (draft.tool !== 'gmail' || !validGmailRecipient(draft.to)) throw new Error('tool_result_recipient_invalid');
    const gmail = await this.getClient();
    const profile = await gmail.users.getProfile({ userId: 'me' });
    const account = profile.data.emailAddress;
    if (!account) throw new Error('tool_result_identity_unverified');
    return { provider: 'gmail', accountId: account, accountLabel: account,
      destinationId: draft.to.trim(), destinationLabel: draft.to.trim() };
  }

  private async getClient(signal?: AbortSignal): Promise<gmail_v1.Gmail> {
    // The Gmail-only client: loading all of googleapis took ~14 s on first use.
    const { gmail, auth } = await import('@googleapis/gmail');
    signal?.throwIfAborted();
    const oauth2 = new auth.OAuth2(this.config.clientId, this.config.clientSecret);
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
    return gmail({ version: 'v1', auth: oauth2, timeout: 30_000, retry: false, signal });
  }

  async execute(action: string, params: Record<string, unknown>, ctx: ConnectorContext): Promise<ConnectorResult> {
    if ((action === 'message.send' || action === 'draft.create') && Object.keys(params).some(key => !isMessageToolField('gmail', key))) {
      return { ok: false, error: 'Unsupported Gmail delivery fields', errorCode: 'unsupported_message_fields' };
    }
    try {
      ctx.abortSignal?.throwIfAborted();
      switch (action) {
        case 'messages.read':
        case 'message.read': {
          const id = resolveGmailMessageId(params);
          if (!id) {
            return {
              ok: false,
              error: '어떤 메일을 읽을지 정해지지 않았어요. 먼저 메일 목록을 불러온 뒤 읽을 메일을 골라 주세요.',
              errorCode: 'gmail_message_id_missing',
            };
          }
          const gmail = await this.getClient(ctx.abortSignal);
          const res = await gmail.users.messages.get({ userId: 'me', id, format: 'full' });
          ctx.abortSignal?.throwIfAborted();
          const body = extractGmailPlainBody(res.data) ?? res.data.snippet ?? '';
          // The read hands on a mail as a person sees it: who sent it and its subject, then the body.
          const headers = gmailHeaderLines(res.data);
          return { ok: true, data: { ...res.data, body: headers.length > 0 ? [...headers, '', body].join('\n') : body } };
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
          if (!messageToolDraft('gmail.message.send', params)) return { ok: false, error: 'invalid_message_payload', errorCode: 'invalid_params' };
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
      if (message.includes('invalid_grant')) return { ok: false, error: 'oauth_refresh_failed', errorCode: 'oauth_refresh_failed' };
      // Google's HTTP status says whose problem it is: missing permission, too many requests, or Google.
      const status = Number((err as { response?: { status?: unknown }; status?: unknown } | null)?.response?.status
        ?? (err as { status?: unknown } | null)?.status);
      const code = status === 403 ? 'gmail_scope_missing'
        : status === 429 ? 'gmail_rate_limited'
          : status >= 500 ? 'gmail_unavailable'
            : status === 401 ? 'oauth_refresh_failed'
              : undefined;
      return {
        ok: false,
        error: code ?? message.slice(0, 1000),
        errorCode: code ?? 'gmail_error',
        ...(Number.isInteger(status) ? { errorDetails: { status } } : {}),
      };
    }
  }
}
