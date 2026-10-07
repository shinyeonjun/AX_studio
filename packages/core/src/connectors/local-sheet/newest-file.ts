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

/** The digit runs of a name, in order ("주문내역_2026-09" -> [2026, 9]). */
function periodKey(fileName: string): number[] {
  return [...fileName.matchAll(/\d+/g)].map((match) => Number(match[0]));
}

/** Within one family only the digits differ, so larger numbers are the later period. */
function comparePeriods(left: number[], right: number[]): number {
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    if (left[index] !== right[index]) return left[index]! - right[index]!;
  }
  return left.length - right.length;
}

/**
 * The latest file in the example's folder that belongs to the example's family, as a path
 * relative to the folder root; the example itself when nothing matches. Latest means the
 * latest period by the name's numbers (re-saving last month's file does not make it this
 * month's), then the modification time. The caller still checks the path stays inside the folder.
 */
export function newestFileInFamily(folderRoot: string, examplePath: string): string {
  const directory = dirname(examplePath);
  const pattern = fileFamilyPattern(basename(examplePath));
  let best: { name: string; period: number[]; modifiedAt: number } | undefined;
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
    const period = periodKey(entry.name);
    const order = best ? comparePeriods(period, best.period) || modifiedAt - best.modifiedAt : 1;
    if (!best || order > 0 || (order === 0 && entry.name > best.name)) {
      best = { name: entry.name, period, modifiedAt };
    }
  }
  return best ? join(directory, best.name) : examplePath;
}
