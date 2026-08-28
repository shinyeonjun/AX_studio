import { google } from 'googleapis';
import type { Connector, ConnectorContext, ConnectorResult } from '../types.js';
import { buildGmailRawMessage } from './mime.js';
import { extractGmailPlainBody } from './body-extract.js';
import { pollGmailNewMessages } from './new-message-poll.js';
import { resolveGmailMessageId } from './message-id.js';

export interface GmailConnectorConfig {
  clientId: string;
  clientSecret?: string;
  refreshToken: string;
  accessToken?: string;
  expiryDate?: number;
  email?: string;
}

export class GmailConnector implements Connector {
  name = 'gmail';

  constructor(private config: GmailConnectorConfig) {}

  private getClient() {
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
    });
    return google.gmail({ version: 'v1', auth: oauth2 });
  }

  async execute(action: string, params: Record<string, unknown>, _ctx: ConnectorContext): Promise<ConnectorResult> {
    try {
      const gmail = this.getClient();
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
          const res = await gmail.users.messages.get({ userId: 'me', id, format: 'full' });
          const body = extractGmailPlainBody(res.data);
          return { ok: true, data: { ...res.data, body: body ?? res.data.snippet ?? '' } };
        }
        case 'messages.search':
        case 'message.search': {
          const res = await gmail.users.messages.list({ userId: 'me', q: (params.query as string) ?? '', maxResults: 10 });
          return { ok: true, data: res.data.messages ?? [] };
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
          const res = await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
          return { ok: true, data: res.data };
        }
        case 'new_message.poll': {
          const poll = await pollGmailNewMessages(gmail, {
            initialized: Boolean(params.initialized),
            seenMessageIds: (params.seenMessageIds as string[]) ?? [],
            historyId: params.historyId as string | undefined,
          });
          return { ok: true, data: poll };
        }
        default:
          return { ok: false, error: `Unknown gmail action: ${action}` };
      }
    } catch (err) {
      const e = err as Error & { code?: string };
      return {
        ok: false,
        error: e.message,
        errorCode: e.message.includes('invalid_grant') ? 'oauth_refresh_failed' : 'gmail_error',
      };
    }
  }
}
