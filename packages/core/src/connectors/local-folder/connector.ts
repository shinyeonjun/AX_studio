import type { Connector, ConnectorContext, ConnectorResult } from '../types.js';
import { fileRefFromLocalScan } from '../../contracts/artifacts/file-ref.js';
import { findLocalFolder, type LocalFolderConnectionConfig } from '../../platform/local-folder-config.js';
import { newFilePoll } from './new-file-poll.js';
import { resolveFileWithinFolderRoot } from '../../platform/local-folder-path.js';
import { scanFolderCheckedAsync } from '../../platform/local-folder-scan-async.js';
import { MAX_FILES_PER_SCAN } from '../../platform/local-folder-scan.js';
import { folderPage, parseFolderPage } from './pagination.js';

export class LocalFolderConnector implements Connector {
  name = 'local_folder';

  constructor(private readonly config: LocalFolderConnectionConfig) {}

  async execute(action: string, params: Record<string, unknown>, ctx: ConnectorContext): Promise<ConnectorResult> {
    if (ctx.abortSignal?.aborted) return { ok: false, error: 'folder_scan_aborted', errorCode: 'aborted' };
    if (action === 'new_file.poll') {
      return newFilePoll(
        this.config,
        {
          folderId: String(params.folderId ?? ''),
          folderPath: typeof params.folderPath === 'string' ? params.folderPath : undefined,
          initialized: Boolean(params.initialized),
          seenFileKeys: (params.seenFileKeys as string[]) ?? [],
          extensions: (params.extensions as string[]) ?? undefined,
        },
        ctx,
      );
    }

    if (action === 'list') {
      const pagination = parseFolderPage(params.offset, params.limit ?? MAX_FILES_PER_SCAN);
      if (!pagination) return { ok: false, error: 'invalid_folder_pagination', errorCode: 'invalid_params' };
      const folderId = String(params.folderId ?? '');
      const folder = findLocalFolder(this.config, folderId);
      if (!folder) return { ok: false, error: 'folder_not_found' };
      const scanned = await scanFolderCheckedAsync(folder.path, (params.extensions as string[]) ?? undefined, ctx.abortSignal);
      if (!scanned.ok) return { ok: false, error: scanned.error, errorCode: scanned.errorCode };
      return { ok: true, data: { folder, ...folderPage(scanned.files, pagination) } };
    }

    if (action === 'read') {
      const folderId = String(params.folderId ?? '');
      const folder = findLocalFolder(this.config, folderId);
      if (!folder) return { ok: false, error: 'folder_not_found' };

      const candidatePath =
        typeof params.path === 'string'
          ? params.path
          : params.file && typeof params.file === 'object' && typeof (params.file as { path?: string }).path === 'string'
            ? (params.file as { path: string }).path
            : '';
      if (!candidatePath.trim()) return { ok: false, error: 'path_required' };

      const resolved = resolveFileWithinFolderRoot(folder.path, candidatePath.trim());
      if (!resolved.ok) {
        return { ok: false, error: resolved.error, errorCode: resolved.errorCode };
      }

      const fileName = resolved.path.split(/[/\\]/).pop() ?? resolved.path;
      const file = fileRefFromLocalScan({
        folderId: folder.id,
        folderPath: folder.path,
        filePath: resolved.path,
        fileName,
        extension: typeof params.extension === 'string' ? params.extension : undefined,
      });
      return { ok: true, data: { file } };
    }

    return { ok: false, error: `Unknown local_folder action: ${action}` };
  }
}
