import type { FileRef } from '../contracts/artifacts/file-ref.js';
import { fileRefFromLocalScan } from '../contracts/artifacts/file-ref.js';
import {
  parseLocalFolderConnectionConfig,
  type LocalFolderConnectionConfig,
} from '../modules/local-folder/connection.js';
import { resolveFileWithinFolderRoot } from '../modules/local-folder/path-security.js';

export interface SourceConnection {
  connector: string;
  connected: boolean;
  config?: Record<string, unknown>;
}

export interface ResolveFileRefResult {
  ok: true;
  path: string;
  file: FileRef;
}

export interface ResolveFileRefError {
  ok: false;
  error: string;
  errorCode: string;
}

export type ResolveFileRefOutcome = ResolveFileRefResult | ResolveFileRefError;

function localFolderConfig(connections: SourceConnection[]): LocalFolderConnectionConfig | null {
  const conn = connections.find((entry) => entry.connector === 'local_folder' && entry.connected);
  if (!conn?.config) return null;
  return parseLocalFolderConnectionConfig(conn.config);
}

function folderForFileRef(
  config: LocalFolderConnectionConfig,
  file: FileRef,
): { id: string; path: string } | undefined {
  if (file.folderId) {
    const match = config.folders.find((folder) => folder.id === file.folderId);
    if (match) return match;
  }
  if (file.folderPath) {
    const match = config.folders.find((folder) => folder.path === file.folderPath);
    if (match) return match;
  }
  if (file.sourceId && file.sourceId !== 'local_folder') {
    const match = config.folders.find((folder) => folder.id === file.sourceId);
    if (match) return match;
  }
  return config.folders.length === 1 ? config.folders[0] : undefined;
}

export function resolveFileRef(
  file: FileRef,
  connections: SourceConnection[],
): ResolveFileRefOutcome {
  const config = localFolderConfig(connections);
  if (!config) {
    return { ok: false, error: 'local_folder_not_connected', errorCode: 'local_folder_not_connected' };
  }

  const folder = folderForFileRef(config, file);
  if (!folder) {
    return { ok: false, error: 'source_folder_not_found', errorCode: 'source_folder_not_found' };
  }

  const resolved = resolveFileWithinFolderRoot(folder.path, file.path);
  if (!resolved.ok) {
    return { ok: false, error: resolved.error, errorCode: resolved.errorCode };
  }

  const normalized = fileRefFromLocalScan({
    folderId: folder.id,
    folderPath: folder.path,
    filePath: resolved.path,
    fileName: file.name,
    extension: file.extension,
    size: file.size,
    modifiedAt: file.modifiedAt,
  });

  return { ok: true, path: resolved.path, file: normalized };
}

/** Reject arbitrary physical paths unless they resolve inside a connected folder. */
export function resolveIngestPath(
  input: { path?: string; file?: FileRef },
  connections: SourceConnection[],
): ResolveFileRefOutcome {
  if (input.file?.path) {
    return resolveFileRef(input.file, connections);
  }

  const path = input.path?.trim();
  if (!path) {
    return { ok: false, error: 'path_required', errorCode: 'path_required' };
  }

  const config = localFolderConfig(connections);
  if (!config) {
    return { ok: false, error: 'local_folder_not_connected', errorCode: 'local_folder_not_connected' };
  }

  for (const folder of config.folders) {
    const resolved = resolveFileWithinFolderRoot(folder.path, path);
    if (!resolved.ok) continue;
    const fileName = path.split(/[/\\]/).pop() ?? path;
    return {
      ok: true,
      path: resolved.path,
      file: fileRefFromLocalScan({
        folderId: folder.id,
        folderPath: folder.path,
        filePath: resolved.path,
        fileName,
      }),
    };
  }

  return { ok: false, error: 'path_outside_source', errorCode: 'path_outside_source' };
}
