import { type LocalFolderEntry } from './connection.js';
import { scanFolder } from './scan.js';
import { resolveFolderRoot } from './path-security.js';

export interface ListedFile {
  filePath: string;
  fileName: string;
  extension: string;
}

export interface LocalFolderResource {
  id: string;
  label: string;
  path: string;
  accessible: boolean;
  files: ListedFile[];
  totalFileCount: number;
  truncated: boolean;
}

const DEFAULT_MAX_FILES_PER_FOLDER = 40;

function toListedFile(file: ListedFile): ListedFile {
  return { filePath: file.filePath, fileName: file.fileName, extension: file.extension };
}

/** Connector-owned source snapshot; host command code exposes this data through source commands. */
export function buildLocalFolderResources(
  folders: LocalFolderEntry[],
  options?: { maxFilesPerFolder?: number; extensions?: string[] },
): LocalFolderResource[] {
  const maxFiles = options?.maxFilesPerFolder ?? DEFAULT_MAX_FILES_PER_FOLDER;
  const extensions = options?.extensions;

  return folders.map((folder) => {
    const access = resolveFolderRoot(folder.path);
    const scanned = scanFolder(folder.path, extensions);
    const truncated = scanned.length > maxFiles;
    const files = (truncated ? scanned.slice(0, maxFiles) : scanned).map(toListedFile);
    return {
      id: folder.id,
      label: folder.label,
      path: folder.path,
      accessible: access.ok,
      files,
      totalFileCount: scanned.length,
      truncated,
    };
  });
}
