export interface LocalFolderEntry {
  id: string;
  label: string;
  path: string;
  addedAt: string;
}

export interface LocalFolderConnectionConfig {
  folders: LocalFolderEntry[];
}

export interface LocalFolderConnectionStatus {
  connected: boolean;
  folders: LocalFolderEntry[];
  folderCount: number;
}

export function parseLocalFolderConnectionConfig(config: unknown): LocalFolderConnectionConfig | null {
  if (!config || typeof config !== 'object') return null;
  const raw = config as { folders?: unknown };
  if (!Array.isArray(raw.folders)) return null;

  const folders: LocalFolderEntry[] = [];
  for (const item of raw.folders) {
    if (!item || typeof item !== 'object') continue;
    const entry = item as Partial<LocalFolderEntry>;
    if (typeof entry.id !== 'string' || typeof entry.path !== 'string') continue;
    folders.push({
      id: entry.id,
      label: typeof entry.label === 'string' ? entry.label : entry.path,
      path: entry.path,
      addedAt: typeof entry.addedAt === 'string' ? entry.addedAt : new Date(0).toISOString(),
    });
  }

  return { folders };
}

export function getLocalFolderConnectionStatus(
  config: unknown,
  connected: boolean,
): LocalFolderConnectionStatus {
  const parsed = parseLocalFolderConnectionConfig(config);
  const folders = parsed?.folders ?? [];
  return {
    connected: connected && folders.length > 0,
    folders,
    folderCount: folders.length,
  };
}

export function upsertLocalFolder(
  config: LocalFolderConnectionConfig | null,
  entry: LocalFolderEntry,
): LocalFolderConnectionConfig {
  const folders = [...(config?.folders ?? [])];
  const index = folders.findIndex((folder) => folder.id === entry.id || folder.path === entry.path);
  if (index >= 0) {
    folders[index] = entry;
  } else {
    folders.push(entry);
  }
  return { folders };
}

export function removeLocalFolder(
  config: LocalFolderConnectionConfig | null,
  folderId: string,
): LocalFolderConnectionConfig {
  return {
    folders: (config?.folders ?? []).filter((folder) => folder.id !== folderId),
  };
}
