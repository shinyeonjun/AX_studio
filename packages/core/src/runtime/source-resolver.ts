import { isAbsolute, resolve } from 'node:path';
import type { FileRef } from '../contracts/artifacts/file-ref.js';
import { fileRefFromLocalScan } from '../contracts/artifacts/file-ref.js';
import {
  findLocalFolder,
  parseLocalFolderConnectionConfig,
  type LocalFolderConnectionConfig,
} from '../modules/local-folder/connection.js';
import {
  isPathContainedInRoot,
  resolveFileWithinFolderRoot,
  resolveFolderRoot,
} from '../modules/local-folder/path-security.js';

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

function folderForFileRef(config: LocalFolderConnectionConfig, file: FileRef) {
  return findLocalFolder(config, file.folderId ?? file.sourceId, file.folderPath);
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

  const path = input.path?.trim().replace(/^['"]|['"]$/g, '');
  if (!path) {
    return { ok: false, error: 'path_required', errorCode: 'path_required' };
  }

  const config = localFolderConfig(connections);
  if (!config) {
    return { ok: false, error: 'local_folder_not_connected', errorCode: 'local_folder_not_connected' };
  }

  const errors: ResolveFileRefError[] = [];
  const insideRootErrors: ResolveFileRefError[] = [];
  const defaultError: ResolveFileRefError = {
    ok: false,
    error: 'path_outside_source',
    errorCode: 'path_outside_source',
  };

  for (const folder of config.folders) {
    const resolved = resolveFileWithinFolderRoot(folder.path, path);
    if (resolved.ok) {
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
    errors.push({ ok: false, error: resolved.error, errorCode: resolved.errorCode });

    // A missing file inside a connected root must stay a file error even when
    // another configured root reports that the same path is outside its root.
    // This distinction is what lets the UI tell the user which boundary failed.
    const root = resolveFolderRoot(folder.path);
    if (root.ok) {
      const lexicalPath = isAbsolute(path) ? path : resolve(folder.path, path);
      if (isPathContainedInRoot(root.rootReal, lexicalPath)) {
        insideRootErrors.push({ ok: false, error: resolved.error, errorCode: resolved.errorCode });
      }
    }
  }

  return (
    insideRootErrors.find((error) => error.errorCode === 'file_not_accessible') ??
    insideRootErrors.find((error) => error.errorCode === 'not_a_file') ??
    errors.find((error) => error.errorCode === 'path_outside_source') ??
    errors.find((error) => error.errorCode === 'file_not_accessible') ??
    errors[0] ??
    defaultError
  );
}
