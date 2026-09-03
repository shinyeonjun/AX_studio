import type { FileRef } from '../../contracts/artifacts/file-ref.js';
import { fileRefFromLocalScan } from '../../contracts/artifacts/file-ref.js';
import { resolveFileWithinFolderRoot } from '../../modules/local-folder/path-security.js';
import type { ResolveFileRefOutcome, SourceConnection } from './contracts.js';
import { folderForFileRef, localFolderConfig } from './folders.js';

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
