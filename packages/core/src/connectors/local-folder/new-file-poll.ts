import type { ConnectorContext, ConnectorResult } from '../types.js';
import { findLocalFolder, type LocalFolderConnectionConfig } from '../../platform/local-folder-config.js';
import { scanFolderCheckedAsync } from '../../platform/local-folder-scan-async.js';
import { MAX_FILES_PER_SCAN, trimSeenFileKeys } from '../../platform/local-folder-scan.js';

export interface NewFilePollParams {
  folderId: string;
  folderPath?: string;
  initialized?: boolean;
  seenFileKeys?: string[];
  extensions?: string[];
}

export async function newFilePoll(
  config: LocalFolderConnectionConfig,
  params: NewFilePollParams,
  ctx: ConnectorContext,
): Promise<ConnectorResult> {
  if (ctx.abortSignal?.aborted) return { ok: false, error: 'folder_scan_aborted', errorCode: 'aborted' };
  const folderId = params.folderId;
  if (!folderId) return { ok: false, error: 'folder_id_required' };

  const folder = findLocalFolder(config, folderId, params.folderPath);
  if (!folder) return { ok: false, error: 'folder_not_found' };

  const scanned = await scanFolderCheckedAsync(folder.path, params.extensions, ctx.abortSignal);
  if (!scanned.ok) return { ok: false, error: scanned.error, errorCode: scanned.errorCode };
  const files = scanned.files;
  // The shared scanner cannot prove completeness at its ceiling. Do not save a
  // baseline/cursor that would silently exclude files on every later poll.
  if (files.length >= MAX_FILES_PER_SCAN) {
    return { ok: false, error: 'folder_scan_limit', errorCode: 'incomplete_scan' };
  }
  const seen = new Set(params.seenFileKeys ?? []);
  const initialized = Boolean(params.initialized);

  if (!initialized) {
    const seenFileKeys =
      files.length <= MAX_FILES_PER_SCAN
        ? files.map((file) => file.key)
        : trimSeenFileKeys(files.map((file) => file.key));
    ctx.log({
      at: new Date().toISOString(),
      level: 'info',
      message: 'local_folder.new_file.baseline',
      data: { folderId, fileCount: seenFileKeys.length },
    });
    return {
      ok: true,
      data: {
        events: [],
        cursor: { initialized: true, folderId, seenFileKeys },
      },
    };
  }

  const newFiles = files.filter((file) => !seen.has(file.key));
  const seenFileKeys = trimSeenFileKeys(files.map((file) => file.key));

  const events = newFiles.map((file) => ({
    type: 'local_folder.new_file' as const,
    payload: {
      folderId: folder.id,
      folderLabel: folder.label,
      folderPath: folder.path,
      filePath: file.filePath,
      fileName: file.fileName,
      extension: file.extension,
      size: file.size,
      modifiedAt: file.modifiedAt,
    },
  }));

  if (events.length > 0) {
    ctx.log({
      at: new Date().toISOString(),
      level: 'info',
      message: 'local_folder.new_file.detected',
      data: { folderId, count: events.length },
    });
  }

  return {
    ok: true,
    data: {
      events,
      cursor: { initialized: true, folderId, seenFileKeys },
    },
  };
}
