import { type LocalFolderEntry } from './connection.js';
import { MAX_FILES_PER_SCAN, scanFolderChecked } from './scan.js';
import { folderPage, parseFolderPage, type FolderPageOptions } from './pagination.js';

export interface ListedFile {
  filePath: string;
  fileName: string;
  extension: string;
}

export interface LocalFolderResource extends Omit<ReturnType<typeof folderPage<ListedFile>>, 'files'> {
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
  options?: FolderPageOptions & { maxFilesPerFolder?: number; extensions?: string[] },
): LocalFolderResource[] {
  const requestedMax = options?.maxFilesPerFolder;
  const maxFiles = typeof requestedMax === 'number' && Number.isFinite(requestedMax) && requestedMax >= 0
    ? Math.min(MAX_FILES_PER_SCAN, Math.floor(requestedMax))
    : DEFAULT_MAX_FILES_PER_FOLDER;
  const extensions = options?.extensions;
  const pagination = parseFolderPage(options?.offset, options?.limit ?? maxFiles);
  if (!pagination) throw new Error('invalid_folder_pagination');

  return folders.map((folder) => {
    const scanned = scanFolderChecked(folder.path, extensions);
    if (!scanned.ok) throw new Error(scanned.error);
    const page = folderPage(scanned.files, pagination);
    return {
      id: folder.id,
      label: folder.label,
      path: folder.path,
      accessible: true,
      ...page,
      files: page.files.map(toListedFile),
    };
  });
}
