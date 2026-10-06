import { readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Removes snapshot folders whose discovery no longer exists (history retention removed the
 * session, or a crash left one behind). Each folder holds copies of the user's data. Only
 * direct child folders of the app's own snapshot root are touched; failures are left for the
 * next start.
 */
export function sweepOrphanSnapshotDirs(snapshotDir: string, sessionIds: ReadonlySet<string>): number {
  let entries: import('node:fs').Dirent[];
  try {
    entries = readdirSync(snapshotDir, { withFileTypes: true });
  } catch {
    return 0;
  }
  let removed = 0;
  for (const entry of entries) {
    if (!entry.isDirectory() || sessionIds.has(entry.name)) continue;
    try {
      rmSync(join(snapshotDir, entry.name), { recursive: true, force: true });
      removed += 1;
    } catch {
      // Locked by another process; retried on the next start.
    }
  }
  return removed;
}
