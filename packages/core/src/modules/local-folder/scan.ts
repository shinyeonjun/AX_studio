import { readdirSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';

export interface ScannedFile {
  /** Stable dedupe key (absolute path). */
  key: string;
  filePath: string;
  fileName: string;
  extension: string;
  size: number;
  modifiedAt: string;
}

const MAX_FILES_PER_SCAN = 5_000;

function normalizeExtensions(extensions?: string[]): Set<string> | null {
  if (!extensions?.length) return null;
  return new Set(
    extensions.map((ext) => {
      const trimmed = ext.trim().toLowerCase();
      return trimmed.startsWith('.') ? trimmed : `.${trimmed}`;
    }),
  );
}

function walkDirectory(rootPath: string, allowed: Set<string> | null, out: ScannedFile[]): void {
  if (out.length >= MAX_FILES_PER_SCAN) return;

  let entries: string[];
  try {
    entries = readdirSync(rootPath);
  } catch {
    return;
  }

  for (const name of entries) {
    if (out.length >= MAX_FILES_PER_SCAN) break;
    const filePath = join(rootPath, name);
    let stat;
    try {
      stat = statSync(filePath);
    } catch {
      continue;
    }

    if (stat.isDirectory()) {
      walkDirectory(filePath, allowed, out);
      continue;
    }
    if (!stat.isFile()) continue;

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
  const allowed = normalizeExtensions(extensions);
  const files: ScannedFile[] = [];
  walkDirectory(rootPath, allowed, files);
  return files;
}

export function trimSeenFileKeys(keys: string[], max = 2_000): string[] {
  return keys.length <= max ? keys : keys.slice(keys.length - max);
}
