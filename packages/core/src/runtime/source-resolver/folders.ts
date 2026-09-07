import {
  findLocalFolder,
  parseLocalFolderConnectionConfig,
  type LocalFolderConnectionConfig,
} from '../../platform/local-folder-config.js';
import type { FileRef } from '../../contracts/artifacts/file-ref.js';
import type { SourceConnection } from './contracts.js';

export function localFolderConfig(connections: SourceConnection[]): LocalFolderConnectionConfig | null {
  const conn = connections.find((entry) => entry.connector === 'local_folder' && entry.connected);
  if (!conn?.config) return null;
  return parseLocalFolderConnectionConfig(conn.config);
}

export function folderForFileRef(config: LocalFolderConnectionConfig, file: FileRef) {
  return findLocalFolder(config, file.folderId ?? file.sourceId, file.folderPath);
}
