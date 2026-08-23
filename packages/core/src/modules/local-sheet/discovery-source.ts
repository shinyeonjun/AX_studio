import { createHash } from 'node:crypto';
import { extname } from 'node:path';
import { readWorkbookFromPath } from './read.js';
import type { DiscoverySourceContext, DiscoverySourceProvider, SourceProfileResult } from '../../contracts/discovery-source.js';

function fingerprintWorkbook(path: string, sheetName: string, table: { columns: Array<{ name: string }>; rows: unknown[] }): string {
  return createHash('sha256').update(JSON.stringify({
    path,
    sheetName,
    columns: table.columns.map((column) => column.name),
    rowCount: table.rows.length,
    rows: table.rows,
  })).digest('hex');
}

export const localSheetDiscoverySource: DiscoverySourceProvider = {
  connector: 'local_sheet',

  async listSources(ctx: DiscoverySourceContext) {
    const paths: Array<{ path: string; label: string }> = [];
    for (const connection of ctx.store.getConnections()) {
      if (connection.connector !== 'local_folder' || !connection.connected) continue;
      const folderPath = typeof connection.config?.folderPath === 'string' ? connection.config.folderPath : undefined;
      if (!folderPath) continue;
      paths.push({ path: folderPath, label: folderPath });
    }
    return paths
      .filter((entry) => ['.csv', '.xlsx', '.xls'].some((ext) => entry.path.toLowerCase().endsWith(ext)))
      .map((entry) => ({
        id: `sheet:${entry.path}`,
        connector: 'local_sheet',
        label: entry.label,
        kind: 'workbook' as const,
        relevance: 0,
        profileSummary: entry.path,
        metadata: { path: entry.path },
      }));
  },

  async profileSource(ctx: DiscoverySourceContext, sourceId: string): Promise<SourceProfileResult | null> {
    if (ctx.budget.sourceReadsUsed >= ctx.budget.sourceReadsMax) return null;
    const path = sourceId.replace(/^sheet:/, '');
    const ext = extname(path).toLowerCase();
    if (!['.csv', '.xlsx', '.xls'].includes(ext)) return null;
    const { workbook, tables } = readWorkbookFromPath(path);
    const firstTableId = workbook.sheets[0]?.tables[0]?.artifactId;
    const table = firstTableId ? tables[firstTableId] : undefined;
    if (!table) return null;
    ctx.budget.sourceReadsUsed += 1;
    const sheetName = workbook.sheets[0]?.name ?? 'sheet1';
    const query = { path, sheetName };
    return {
      descriptor: {
        id: sourceId,
        connector: 'local_sheet',
        label: sheetName,
        kind: 'workbook',
        relevance: 0,
        profileSummary: table.columns.map((column) => column.name).join(', '),
        metadata: { path, storedPath: path },
      },
      table,
      fingerprint: fingerprintWorkbook(path, sheetName, table),
      queryJson: JSON.stringify(query),
    };
  },
};
