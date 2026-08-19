import { google } from 'googleapis';
import type { Connector, ConnectorContext, ConnectorResult } from '../types.js';

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
          const id = params.messageId as string;
          const res = await gmail.users.messages.get({ userId: 'me', id, format: 'full' });
          return { ok: true, data: res.data };
        }
        case 'messages.search':
        case 'message.search': {
          const res = await gmail.users.messages.list({ userId: 'me', q: (params.query as string) ?? '', maxResults: 10 });
          return { ok: true, data: res.data.messages ?? [] };
        }
        case 'draft.create': {
          const raw = Buffer.from(
            `To: ${params.to}\r\nSubject: ${params.subject ?? 'Re'}\r\n\r\n${params.body ?? ''}`,
          ).toString('base64url');
          const res = await gmail.users.drafts.create({ userId: 'me', requestBody: { message: { raw } } });
          return { ok: true, data: res.data };
        }
        case 'message.send': {
          const raw = Buffer.from(
            `To: ${params.to}\r\nSubject: ${params.subject ?? 'Re'}\r\n\r\n${params.body ?? ''}`,
          ).toString('base64url');
          const res = await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
          return { ok: true, data: res.data };
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
