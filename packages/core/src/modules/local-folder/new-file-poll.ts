import type { ConnectorContext, ConnectorResult } from '../types.js';
import type { LocalFolderConnectionConfig } from './connection.js';
import { MAX_FILES_PER_SCAN, scanFolder, trimSeenFileKeys } from './scan.js';

export interface NewFilePollParams {
  folderId: string;
  initialized?: boolean;
  seenFileKeys?: string[];
  extensions?: string[];
}

export async function newFilePoll(
  config: LocalFolderConnectionConfig,
  params: NewFilePollParams,
  ctx: ConnectorContext,
): Promise<ConnectorResult> {
  const folderId = params.folderId;
  if (!folderId) return { ok: false, error: 'folder_id_required' };

  const folder = config.folders.find((entry) => entry.id === folderId);
  if (!folder) return { ok: false, error: 'folder_not_found' };

  const files = scanFolder(folder.path, params.extensions);
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
  const seenFileKeys = trimSeenFileKeys([...seen, ...newFiles.map((file) => file.key)]);

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
