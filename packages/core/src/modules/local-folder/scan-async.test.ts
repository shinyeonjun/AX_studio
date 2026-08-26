import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { scanFolderCheckedAsync } from './scan-async.js';

describe('scanFolderCheckedAsync', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    vi.unstubAllEnvs();
    for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
    tempDirs.length = 0;
  });

  it('falls back when the scan worker exits without returning a result', async () => {
    const folderPath = mkdtempSync(join(tmpdir(), 'ax-scan-folder-'));
    const workerDir = mkdtempSync(join(tmpdir(), 'ax-scan-worker-'));
    tempDirs.push(folderPath, workerDir);
    writeFileSync(join(folderPath, 'report.pdf'), 'report');
    const workerPath = join(workerDir, 'empty-worker.js');
    writeFileSync(workerPath, '');
    vi.stubEnv('VITEST', 'false');
    vi.stubEnv('AX_SCAN_WORKER_PATH', workerPath);

    const result = await scanFolderCheckedAsync(folderPath, ['pdf']);

    expect(result).toMatchObject({
      ok: true,
      files: [{ fileName: 'report.pdf', extension: '.pdf' }],
    });
  });
});
