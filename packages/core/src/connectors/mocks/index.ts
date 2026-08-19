import type { Connector, ConnectorContext, ConnectorResult } from '../types.js';

export interface MockGmailMessage {
  id: string;
  from: string;
  subject: string;
  body: string;
}

export class MockGmailConnector implements Connector {
  name = 'gmail';
  messages: MockGmailMessage[] = [];
  drafts: Array<{ id: string; to: string; body: string }> = [];
  sent: Array<{ to: string; body: string }> = [];

  async execute(action: string, params: Record<string, unknown>, ctx: ConnectorContext): Promise<ConnectorResult> {
    switch (action) {
      case 'messages.read':
      case 'message.read': {
        const id = params.messageId as string;
        const msg = this.messages.find((m) => m.id === id) ?? this.messages[0];
        ctx.log({ at: new Date().toISOString(), level: 'info', message: 'gmail.read', data: { id: msg?.id } });
        return { ok: true, data: msg };
      }
      case 'messages.search':
      case 'message.search': {
        const q = (params.query as string) ?? '';
        const results = this.messages.filter(
          (m) => m.subject.includes(q) || m.body.includes(q) || m.from.includes(q),
        );
        return { ok: true, data: results };
      }
      case 'draft.create': {
        const draft = {
          id: `draft-${Date.now()}`,
          to: (params.to as string) ?? '',
          body: (params.body as string) ?? '',
        };
        this.drafts.push(draft);
        ctx.variables.lastDraftId = draft.id;
        return { ok: true, data: draft };
      }
      case 'message.send': {
        const send = { to: (params.to as string) ?? '', body: (params.body as string) ?? '' };
        this.sent.push(send);
        return { ok: true, data: send };
      }
      case 'label.apply':
        return { ok: true, data: { label: params.label } };
      default:
        return { ok: false, error: `Unknown gmail action: ${action}` };
    }
  }
}

export class MockSlackConnector implements Connector {
  name = 'slack';
  messages: Array<{ channel: string; text: string }> = [];

  async execute(action: string, params: Record<string, unknown>, ctx: ConnectorContext): Promise<ConnectorResult> {
    if (action === 'message.send') {
      const msg = { channel: (params.channel as string) ?? '#general', text: (params.text as string) ?? '' };
      this.messages.push(msg);
      ctx.log({ at: new Date().toISOString(), level: 'info', message: 'slack.send', data: msg });
      return { ok: true, data: msg };
    }
    return { ok: false, error: `Unknown slack action: ${action}` };
  }
}

export class MockLocalSheetConnector implements Connector {
  name = 'local_sheet';
  files: Record<string, unknown[][]> = {
    './data/sales.csv': [
      ['week', 'sales'],
      ['2026-W01', '1200000'],
      ['2026-W02', '980000'],
    ],
  };

  async execute(action: string, params: Record<string, unknown>, ctx: ConnectorContext): Promise<ConnectorResult> {
    if (action === 'read') {
      const path = params.path as string;
      const data = this.files[path];
      if (!data) return { ok: false, error: 'file_not_found', errorCode: 'file_not_found' };
      ctx.variables.sheetData = data;
      return { ok: true, data };
    }
    return { ok: false, error: `Unknown local_sheet action: ${action}` };
  }
}

export class MockRdbConnector implements Connector {
  name = 'rdb';
  tables: Record<string, unknown[]> = {
    sales: [
      { product: 'A', amount: 1000, week: '2026-W01' },
      { product: 'B', amount: 500, week: '2026-W01' },
      { product: 'A', amount: 600, week: '2026-W02' },
    ],
    inventory: [
      { product: 'A', stock: 0, date: '2026-08-11' },
      { product: 'A', stock: 50, date: '2026-08-14' },
    ],
  };

  async execute(action: string, params: Record<string, unknown>, ctx: ConnectorContext): Promise<ConnectorResult> {
    if (action === 'schema.describe') {
      return { ok: true, data: Object.keys(this.tables) };
    }
    if (action === 'query.read' || action === 'query') {
      const table = (params.table as string) ?? 'sales';
      const rows = this.tables[table] ?? [];
      ctx.variables.queryResult = rows;
      return { ok: true, data: rows };
    }
    return { ok: false, error: `Unknown rdb action: ${action}` };
  }
}

export class MockReportConnector implements Connector {
  name = 'report';
  outputs: Array<{ format: string; content: string }> = [];

  async execute(action: string, params: Record<string, unknown>, ctx: ConnectorContext): Promise<ConnectorResult> {
    if (action === 'html.render' || action === 'pdf.generate' || action === 'docx.fill') {
      const html = `<html><body><h1>${params.title ?? 'Report'}</h1><pre>${JSON.stringify(params.data ?? ctx.variables, null, 2)}</pre></body></html>`;
      this.outputs.push({ format: action, content: html });
      ctx.variables.reportHtml = html;
      return { ok: true, data: { html } };
    }
    return { ok: false, error: `Unknown report action: ${action}` };
  }
}
