import { randomBytes } from 'node:crypto';
import { closeSync, fsyncSync, openSync, renameSync, rmSync, writeSync } from 'node:fs';

const RENAME_RETRY_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);
const RENAME_ATTEMPTS = 4;
const RENAME_RETRY_DELAY_MS = 25;

function pause(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Write-to-temp, fsync, then rename, so a crash never leaves a truncated file
 * at `path`: readers see either the old content or the new one. Windows can
 * briefly refuse the replace while an AV scanner or indexer holds the target,
 * so the rename is retried a few times before failing.
 */
export function writeFileAtomicSync(path: string, data: string | Uint8Array): void {
  const temporary = `${path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  try {
    const handle = openSync(temporary, 'w');
    try {
      const bytes = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
      let offset = 0;
      while (offset < bytes.byteLength) offset += writeSync(handle, bytes, offset, bytes.byteLength - offset);
      fsyncSync(handle);
    } finally {
      closeSync(handle);
    }
    for (let attempt = 1; ; attempt += 1) {
      try {
        renameSync(temporary, path);
        return;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (attempt >= RENAME_ATTEMPTS || !code || !RENAME_RETRY_CODES.has(code)) throw error;
        pause(RENAME_RETRY_DELAY_MS * attempt);
      }
    }
  } catch (error) {
    try { rmSync(temporary, { force: true }); } catch { /* Preserve the write error. */ }
    throw error;
  }
}
