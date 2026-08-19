import type { Connector, ConnectorContext, ConnectorResult } from '../types.js';

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
