import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { scanFolderChecked, type ScanFolderResult } from './local-folder-scan.js';

const SCAN_WORKER_TIMEOUT_MS = 30_000;
const aborted = (): ScanFolderResult => ({ ok: false, error: 'folder_scan_aborted', errorCode: 'aborted' });

function shouldUseSyncScan(): boolean {
  return process.env.VITEST === 'true' || process.env.AX_SCAN_SYNC === '1';
}

function workerScriptPath(): string {
  if (process.env.AX_SCAN_WORKER_PATH) return process.env.AX_SCAN_WORKER_PATH;
  return fileURLToPath(new URL('./local-folder-scan-worker.js', import.meta.url));
}

export function scanFolderCheckedAsync(
  rootPath: string,
  extensions?: string[],
  abortSignal?: AbortSignal,
): Promise<ScanFolderResult> {
  if (abortSignal?.aborted) return Promise.resolve(aborted());
  if (shouldUseSyncScan()) {
    const result = scanFolderChecked(rootPath, extensions);
    return Promise.resolve(abortSignal?.aborted ? aborted() : result);
  }

  return runScanWorker(rootPath, extensions, abortSignal).catch((error: unknown): ScanFolderResult => {
    if (abortSignal?.aborted) return aborted();
    // A failed or timed-out worker must not repeat its unbounded workload on
    // the host event loop, where cancellation and the deadline cannot run.
    const timedOut = error instanceof Error && error.message === 'scan_worker_timeout';
    return {
      ok: false,
      error: timedOut ? 'folder_scan_timeout' : 'folder_scan_worker_failed',
      errorCode: timedOut ? 'scan_timeout' : 'scan_worker_failed',
    };
  });
}

function runScanWorker(
  rootPath: string,
  extensions?: string[],
  abortSignal?: AbortSignal,
): Promise<ScanFolderResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerScriptPath(), {
      workerData: { rootPath, extensions },
    });

    let settled = false;
    const finish = (result?: ScanFolderResult, error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      abortSignal?.removeEventListener('abort', onAbort);
      void worker.terminate().then(() => {
        if (abortSignal?.aborted) resolve(aborted());
        else if (error) reject(error);
        else resolve(result!);
      }, reject);
    };
    const onAbort = () => finish(aborted());
    const timeout = setTimeout(() => finish(undefined, new Error('scan_worker_timeout')), SCAN_WORKER_TIMEOUT_MS);
    abortSignal?.addEventListener('abort', onAbort, { once: true });
    worker.once('message', (message: ScanFolderResult) => finish(message));
    worker.once('error', (error) => finish(undefined, error));
    worker.once('exit', (code) => {
      if (code !== 0) finish(undefined, new Error(`scan_worker_exit_${code}`));
      else finish(undefined, new Error('scan_worker_exit_without_result'));
    });
    if (abortSignal?.aborted) onAbort();
  });
}
