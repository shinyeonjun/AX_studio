import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalFolderConnector } from './connector.js';
import { scanFolderCheckedAsync } from '../../platform/local-folder-scan-async.js';

afterEach(() => vi.unstubAllEnvs());

describe('local-folder host cancellation', () => {
  it.each(['list', 'read', 'new_file.poll'])('does not access files for an already cancelled %s', async action => {
    const connector = new LocalFolderConnector({ folders: [{
      id: 'selected', label: 'Selected', path: 'does-not-exist', addedAt: new Date(0).toISOString(),
    }] });
    expect(await connector.execute(action, { folderId: 'selected', path: 'sample.txt' }, {
      executionId: 'cancelled', variables: {}, log: () => {}, abortSignal: AbortSignal.abort(),
    })).toMatchObject({ ok: false, errorCode: 'aborted' });
  });

  it('terminates an in-flight scan worker on cancellation without the synchronous fallback', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ax-cancel-worker-'));
    const worker = join(root, 'worker.cjs');
    writeFileSync(worker, 'setInterval(() => {}, 1000);');
    vi.stubEnv('VITEST', 'false');
    vi.stubEnv('AX_SCAN_SYNC', '0');
    vi.stubEnv('AX_SCAN_WORKER_PATH', worker);
    const controller = new AbortController();
    try {
      const pending = scanFolderCheckedAsync(root, undefined, controller.signal);
      controller.abort();
      expect(await pending).toMatchObject({ ok: false, errorCode: 'aborted' });
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
