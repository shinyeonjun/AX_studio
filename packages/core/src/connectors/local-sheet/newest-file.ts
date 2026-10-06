import { readdirSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

/**
 * The family a file name belongs to, from the name itself: every run of digits may change
 * (주문내역_2026-08.xlsx, 주문내역_2026-09.xlsx, sales_q3_v2.xlsx …), everything else must match.
 */
export function fileFamilyPattern(fileName: string): RegExp {
  const escaped = fileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped.replace(/\d+/g, '\\d+')}$`, 'i');
}

/**
 * The newest file (by modification time) in the example's folder that belongs to the example's
 * family, as a path relative to the folder root; the example itself when nothing newer matches.
 * The caller still checks the returned path stays inside the folder.
 */
export function newestFileInFamily(folderRoot: string, examplePath: string): string {
  const directory = dirname(examplePath);
  const pattern = fileFamilyPattern(basename(examplePath));
  let best: { name: string; modifiedAt: number } | undefined;
  let entries: import('node:fs').Dirent[];
  try {
    entries = readdirSync(join(folderRoot, directory), { withFileTypes: true });
  } catch {
    return examplePath;
  }
  for (const entry of entries) {
    if (!entry.isFile() || !pattern.test(entry.name) || entry.name.startsWith('~$')) continue;
    let modifiedAt: number;
    try {
      modifiedAt = statSync(join(folderRoot, directory, entry.name)).mtimeMs;
    } catch {
      continue;
    }
    if (!best || modifiedAt > best.modifiedAt || (modifiedAt === best.modifiedAt && entry.name > best.name)) {
      best = { name: entry.name, modifiedAt };
    }
  }
  return best ? join(directory, best.name) : examplePath;
}
