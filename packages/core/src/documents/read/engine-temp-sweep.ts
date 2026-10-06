import { readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

/** `.<name>.<random>.tmp`: the atomic-write temp files the document engine creates next to its outputs. */
const ENGINE_TEMP_FILE = /^\..+\.tmp$/u;
const DEFAULT_MIN_AGE_MS = 60 * 60_000;
/** Bounds the walk, not meaning: engine folders are shallow (root/document-id/file). */
const MAX_DEPTH = 4;

/**
 * Removes temp files a force-killed engine worker left behind (a timeout, a cancelled run or app
 * exit kills the worker before its own cleanup runs). Only files with the engine's temp name and
 * older than `minAgeMs` are touched, so a worker that is still writing is never disturbed.
 */
export async function sweepEngineTempFiles(
  roots: readonly string[],
  options: { minAgeMs?: number; now?: number } = {},
): Promise<number> {
  const cutoff = (options.now ?? Date.now()) - (options.minAgeMs ?? DEFAULT_MIN_AGE_MS);
  let removed = 0;
  const walk = async (dir: string, depth: number): Promise<void> => {
    let entries: import('node:fs').Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (depth < MAX_DEPTH) await walk(path, depth + 1);
        continue;
      }
      if (!entry.isFile() || !ENGINE_TEMP_FILE.test(entry.name)) continue;
      try {
        if ((await stat(path)).mtimeMs > cutoff) continue;
        await rm(path, { force: true });
        removed += 1;
      } catch {
        // Gone or locked; the next start tries again.
      }
    }
  };
  for (const root of roots) await walk(root, 0);
  return removed;
}
