import { lstatSync, readdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import { isPathContainedInRoot, resolveFolderRoot } from './local-folder-path.js';

export interface ScannedFile {
  /** Stable dedupe key (absolute path). */
  key: string;
  filePath: string;
  fileName: string;
  extension: string;
  size: number;
  modifiedAt: string;
}

export const MAX_FILES_PER_SCAN = 5_000;

export type ScanFolderResult =
  | { ok: true; files: ScannedFile[] }
  | { ok: false; error: string; errorCode: string };

export function normalizeExtensions(extensions?: string[]): Set<string> | null {
  if (!extensions?.length) return null;
  const normalized = extensions
    .map((ext) => ext.trim().toLowerCase())
    .filter(Boolean)
    .map((ext) => ext.startsWith('.') ? ext : `.${ext}`);
  return normalized.length > 0 ? new Set(normalized) : null;
}

function walkDirectory(
  rootReal: string,
  currentPath: string,
  allowed: Set<string> | null,
  out: ScannedFile[],
): void {
  if (out.length >= MAX_FILES_PER_SCAN) return;

  let entries: string[];
  try {
    entries = readdirSync(currentPath);
  } catch {
    return;
  }

  for (const name of entries) {
    if (out.length >= MAX_FILES_PER_SCAN) break;
    const filePath = join(currentPath, name);
    let stat;
    try {
      stat = lstatSync(filePath);
    } catch {
      continue;
    }

    if (stat.isSymbolicLink()) continue;

    if (stat.isDirectory()) {
      if (!isPathContainedInRoot(rootReal, filePath)) continue;
      walkDirectory(rootReal, filePath, allowed, out);
      continue;
    }
    if (!stat.isFile()) continue;
    if (!isPathContainedInRoot(rootReal, filePath)) continue;

    const extension = extname(name).toLowerCase();
    if (allowed && !allowed.has(extension)) continue;

    out.push({
      key: filePath,
      filePath,
      fileName: name,
      extension,
      size: stat.size,
      modifiedAt: stat.mtime.toISOString(),
    });
  }
}

export function scanFolder(rootPath: string, extensions?: string[]): ScannedFile[] {
  const root = resolveFolderRoot(rootPath);
  if (!root.ok) return [];

  const allowed = normalizeExtensions(extensions);
  const files: ScannedFile[] = [];
  walkDirectory(root.rootReal, root.rootReal, allowed, files);
  return files;
}

/** Runtime callers need to distinguish an empty folder from an inaccessible folder. */
export function scanFolderChecked(rootPath: string, extensions?: string[]): ScanFolderResult {
  const root = resolveFolderRoot(rootPath);
  if (!root.ok) return root;

  const allowed = normalizeExtensions(extensions);
  const files: ScannedFile[] = [];
  walkDirectory(root.rootReal, root.rootReal, allowed, files);
  return { ok: true, files };
}

export function trimSeenFileKeys(keys: string[], max = MAX_FILES_PER_SCAN): string[] {
  return keys.length <= max ? keys : keys.slice(keys.length - max);
}
