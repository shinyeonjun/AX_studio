import { relative, sep } from 'node:path';
import type { Connector, ConnectorContext } from '../../../connectors/types.js';
import { parseLocalFolderConnectionConfig } from '../../../platform/local-folder-config.js';
import type { ReportFileSummary } from '../planner/catalog.js';

const SHEET_EXTENSIONS = ['.csv', '.xlsx', '.xls'];
/** Enough for months of monthly files across a few folders; the AI pages through them. */
const MAX_REPORT_FILES = 500;

interface ListedFile {
  filePath?: unknown;
  modifiedAt?: unknown;
}

/**
 * The CSV/xlsx files in the connected folders, by folder and path inside it. Only names and dates
 * are listed; a file is read only after it is chosen as a source. A folder that cannot be listed
 * is left out rather than failing the report.
 */
export async function listReportFiles(ctx: ConnectorContext, localFolder: Connector | undefined): Promise<ReportFileSummary[]> {
  if (!localFolder) return [];
  const connection = ctx.connections?.find((entry) => entry.connector === 'local_folder' && entry.connected);
  const folders = connection?.config ? parseLocalFolderConnectionConfig(connection.config)?.folders ?? [] : [];
  const files: ReportFileSummary[] = [];
  for (const folder of folders) {
    if (files.length >= MAX_REPORT_FILES) break;
    let result;
    try {
      result = await localFolder.execute('list', { folderId: folder.id, extensions: SHEET_EXTENSIONS }, ctx);
    } catch {
      continue;
    }
    if (!result.ok || !result.data || typeof result.data !== 'object') continue;
    const listed = (result.data as { files?: unknown }).files;
    if (!Array.isArray(listed)) continue;
    for (const file of listed as ListedFile[]) {
      if (typeof file.filePath !== 'string') continue;
      const inFolder = relative(folder.path, file.filePath);
      if (!inFolder || inFolder.startsWith('..')) continue;
      if (inFolder.split(sep).some((part) => part.startsWith('~$'))) continue;
      files.push({ folderId: folder.id, folderLabel: folder.label, path: inFolder.split(sep).join('/'),
        ...(typeof file.modifiedAt === 'string' ? { modifiedAt: file.modifiedAt } : {}) });
      if (files.length >= MAX_REPORT_FILES) break;
    }
  }
  return files;
}
