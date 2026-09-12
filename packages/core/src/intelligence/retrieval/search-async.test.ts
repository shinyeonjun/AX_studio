import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { searchLocalFolderAsync } from './search-async.js';

describe('bounded background folder search', () => {
  const dirs: string[] = [];
  afterEach(() => {
    vi.useRealTimers(); vi.unstubAllEnvs();
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });
  function setup(script: string) {
    const path = mkdtempSync(join(tmpdir(), 'ax-search-worker-')); dirs.push(path);
    const worker = join(path, 'worker.cjs'); writeFileSync(worker, script);
    writeFileSync(join(path, 'match.txt'), 'needle');
    vi.stubEnv('AX_SEARCH_WORKER_PATH', worker);
    return { id: 'folder', label: 'Test', path, addedAt: new Date().toISOString() };
  }
  it('cancels a stuck worker without blocking the host event loop', async () => {
    const folder = setup('setInterval(() => {}, 1000)');
    const abort = new AbortController();
    const result = searchLocalFolderAsync(folder, 'needle', undefined, abort.signal);
    const assertion = expect(result).rejects.toThrow('folder_search_aborted');
    setTimeout(() => abort.abort(), 10);
    await assertion;
  });
  it('times out without repeating the scan synchronously', async () => {
    const folder = setup('setInterval(() => {}, 1000)');
    vi.useFakeTimers();
    const result = searchLocalFolderAsync(folder, 'needle');
    const assertion = expect(result).rejects.toThrow('folder_search_timeout');
    await vi.advanceTimersByTimeAsync(30_000);
    await assertion;
  });
  it.each(['', "throw new Error('private path')"])('fails closed if a worker exits without results', async script => {
    await expect(searchLocalFolderAsync(setup(script), 'needle')).rejects.toThrow(/folder_search_worker/);
  });
});
