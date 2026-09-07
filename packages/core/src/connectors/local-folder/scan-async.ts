import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { scanFolderCheckedAsync as scanOnPlatform } from '../../platform/local-folder-scan-async.js';
import { scanFolderChecked, type ScanFolderResult, type ScannedFile } from './scan.js';

const aborted = (): ScanFolderResult => ({ ok: false, error: 'folder_scan_aborted', errorCode: 'aborted' });

export async function scanFolderAsync(rootPath: string, extensions?: string[], abortSignal?: AbortSignal): Promise<ScannedFile[]> {
  const result = await scanFolderCheckedAsync(rootPath, extensions, abortSignal);
  return result.ok ? result.files : [];
}

export async function scanFolderCheckedAsync(rootPath: string, extensions?: string[], abortSignal?: AbortSignal): Promise<ScanFolderResult> {
  if (abortSignal?.aborted) return aborted();
  if (!abortSignal || process.env.VITEST === 'true' || process.env.AX_SCAN_SYNC === '1') {
    const result = await scanOnPlatform(rootPath, extensions);
    return abortSignal?.aborted ? aborted() : result;
  }

  // Own termination when the caller supplies cancellation; the platform scanner's
  // legacy fallback has no signal and may otherwise rescan after cancellation.
  try {
    return await new Promise<ScanFolderResult>((resolve, reject) => {
      const worker = new Worker(process.env.AX_SCAN_WORKER_PATH
        ?? fileURLToPath(new URL('../../platform/local-folder-scan-worker.js', import.meta.url)), {
        workerData: { rootPath, extensions },
      });
      let settled = false;
      const finish = (result?: ScanFolderResult, error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        abortSignal.removeEventListener('abort', onAbort);
        void worker.terminate().then(() => {
          if (abortSignal.aborted) resolve(aborted());
          else if (error) reject(error);
          else resolve(result!);
        }, reject);
      };
      const onAbort = () => finish(aborted());
      const timer = setTimeout(() => finish(undefined, new Error('scan_worker_timeout')), 30_000);
      abortSignal.addEventListener('abort', onAbort, { once: true });
      worker.once('message', (result: ScanFolderResult) => finish(result));
      worker.once('error', error => finish(undefined, error));
      worker.once('exit', () => finish(undefined, new Error('scan_worker_exit_without_result')));
      if (abortSignal.aborted) onAbort();
    });
  } catch {
    return abortSignal.aborted ? aborted() : scanFolderChecked(rootPath, extensions);
  }
}
