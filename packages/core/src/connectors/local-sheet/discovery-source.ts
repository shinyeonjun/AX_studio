import { createHash } from 'node:crypto';
import { statSync } from 'node:fs';
import { basename, extname } from 'node:path';
import { readWorkbookFromPath } from './read.js';
import {
  findLocalFolder,
  parseLocalFolderConnectionConfig,
  type LocalFolderEntry,
} from '../../platform/local-folder-config.js';
import { resolveFileWithinFolderRoot } from '../../platform/local-folder-path.js';
import { scanFolderCheckedAsync } from '../../platform/local-folder-scan-async.js';
import type { ScannedFile } from '../../platform/local-folder-scan.js';
import type { DiscoverySourceContext, DiscoverySourceProvider, SourceProfileResult } from '../../contracts/discovery-source.js';

const SHEET_EXTENSIONS = ['csv', 'xlsx', 'xls'];
const SOURCE_PREFIX = 'sheet:';

function fingerprintWorkbook(path: string, sheetName: string, table: { columns: Array<{ name: string }>; rows: unknown[] }): string {
  return createHash('sha256').update(JSON.stringify({
    path,
    sheetName,
    columns: table.columns.map((column) => column.name),
    rowCount: table.rows.length,
    rows: table.rows,
  })).digest('hex');
}

function sourceIdFor(folderId: string, filePath: string): string {
  return `${SOURCE_PREFIX}${encodeURIComponent(folderId)}:${encodeURIComponent(filePath)}`;
}

function parseSourceId(sourceId: string): { folderId: string; filePath: string } | null {
  if (!sourceId.startsWith(SOURCE_PREFIX)) return null;
  const encoded = sourceId.slice(SOURCE_PREFIX.length);
  const separator = encoded.indexOf(':');
  if (separator < 0) return null;
  try {
    const folderId = decodeURIComponent(encoded.slice(0, separator));
    const filePath = decodeURIComponent(encoded.slice(separator + 1));
    if (!folderId || !filePath) return null;
    return { folderId, filePath };
  } catch {
    return null;
  }
}

function connectedLocalFolders(ctx: DiscoverySourceContext): LocalFolderEntry[] {
  return ctx.store.getConnections()
    .filter((connection) => connection.connector === 'local_folder' && connection.connected)
    .flatMap((connection) => parseLocalFolderConnectionConfig(connection.config)?.folders ?? []);
}

function descriptorForFile(folder: LocalFolderEntry, file: ScannedFile) {
  return {
    id: sourceIdFor(folder.id, file.filePath),
    connector: 'local_sheet' as const,
    label: `${folder.label}/${file.fileName}`,
    kind: 'workbook' as const,
    relevance: 0,
    profileSummary: file.fileName,
    metadata: {
      folderId: folder.id,
      folderLabel: folder.label,
      path: file.filePath,
      extension: file.extension,
      size: file.size,
      modifiedAt: file.modifiedAt,
    },
  };
}

export const localSheetDiscoverySource: DiscoverySourceProvider = {
  connector: 'local_sheet',

  async listSources(ctx: DiscoverySourceContext) {
    const sources = [];
    for (const folder of connectedLocalFolders(ctx)) {
      const scanned = await scanFolderCheckedAsync(folder.path, SHEET_EXTENSIONS);
      if (!scanned.ok) continue;
      sources.push(...scanned.files.map((file) => descriptorForFile(folder, file)));
    }
    return sources;
  },

  async profileSource(ctx: DiscoverySourceContext, sourceId: string): Promise<SourceProfileResult | null> {
    if (ctx.budget.sourceReadsUsed >= ctx.budget.sourceReadsMax) return null;
    const parsed = parseSourceId(sourceId);
    if (!parsed) return null;

    const folders = connectedLocalFolders(ctx);
    const folder = findLocalFolder(
      folders.length === 0 ? null : { folders },
      parsed.folderId,
    );
    if (!folder) return null;
    const resolved = resolveFileWithinFolderRoot(folder.path, parsed.filePath);
    if (!resolved.ok) return null;

    const ext = extname(resolved.path).toLowerCase();
    if (!SHEET_EXTENSIONS.some((extension) => `.${extension}` === ext)) return null;

    let workbook: ReturnType<typeof readWorkbookFromPath>;
    try {
      if ((ext === '.xlsx' || ext === '.xls') && statSync(resolved.path).size === 0) return null;
      workbook = readWorkbookFromPath(resolved.path);
    } catch {
      return null;
    }
    const firstTableId = workbook.workbook.sheets[0]?.tables[0]?.artifactId;
    const table = firstTableId ? workbook.tables[firstTableId] : undefined;
    if (!table) return null;

    ctx.budget.sourceReadsUsed += 1;
    const sheetName = workbook.workbook.sheets[0]?.name ?? 'sheet1';
    const query = { path: resolved.path, sheetName, folderId: folder.id };
    return {
      descriptor: {
        id: sourceId,
        connector: 'local_sheet',
        label: `${folder.label}/${basename(resolved.path)}`,
        kind: 'workbook',
        relevance: 0,
        profileSummary: table.columns.map((column) => column.name).join(', '),
        metadata: { path: resolved.path, storedPath: resolved.path, folderId: folder.id },
      },
      table,
      fingerprint: fingerprintWorkbook(resolved.path, sheetName, table),
      queryJson: JSON.stringify(query),
    };
  },
};
