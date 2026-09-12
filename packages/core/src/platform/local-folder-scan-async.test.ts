import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { scanFolderCheckedAsync } from './local-folder-scan-async.js';

describe('scanFolderCheckedAsync', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
    tempDirs.length = 0;
  });

  it('reports worker failure instead of rescanning on the host when no result arrives', async () => {
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
      ok: false,
      errorCode: 'scan_worker_failed',
    });
  });

  it('reports a bounded timeout instead of rescanning on the host', async () => {
    const folderPath = mkdtempSync(join(tmpdir(), 'ax-scan-folder-'));
    const workerDir = mkdtempSync(join(tmpdir(), 'ax-scan-worker-'));
    tempDirs.push(folderPath, workerDir);
    writeFileSync(join(folderPath, 'report.pdf'), 'report');
    const workerPath = join(workerDir, 'hanging-worker.js');
    writeFileSync(workerPath, 'setInterval(() => {}, 1000);');
    vi.stubEnv('VITEST', 'false');
    vi.stubEnv('AX_SCAN_WORKER_PATH', workerPath);
    vi.useFakeTimers();

    const resultPromise = scanFolderCheckedAsync(folderPath, ['pdf']);
    await vi.advanceTimersByTimeAsync(30_000);

    await expect(resultPromise).resolves.toMatchObject({
      ok: false,
      errorCode: 'scan_timeout',
    });
  });

  it('reports a crashing worker without hiding the failure behind a synchronous scan', async () => {
    const folderPath = mkdtempSync(join(tmpdir(), 'ax-scan-crash-'));
    tempDirs.push(folderPath);
    writeFileSync(join(folderPath, 'report.pdf'), 'report');
    const workerPath = join(folderPath, 'crashing-worker.js');
    writeFileSync(workerPath, "throw new Error('private diagnostic');");
    vi.stubEnv('VITEST', 'false');
    vi.stubEnv('AX_SCAN_WORKER_PATH', workerPath);

    await expect(scanFolderCheckedAsync(folderPath, ['pdf'])).resolves.toEqual({
      ok: false,
      error: 'folder_scan_worker_failed',
      errorCode: 'scan_worker_failed',
    });
  });
});
