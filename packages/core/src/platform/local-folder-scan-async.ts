import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { scanFolderChecked, type ScanFolderResult, type ScannedFile } from './local-folder-scan.js';

const SCAN_WORKER_TIMEOUT_MS = 30_000;

function shouldUseSyncScan(): boolean {
  return process.env.VITEST === 'true' || process.env.AX_SCAN_SYNC === '1';
}

function workerScriptPath(): string {
  if (process.env.AX_SCAN_WORKER_PATH) return process.env.AX_SCAN_WORKER_PATH;
  return fileURLToPath(new URL('./local-folder-scan-worker.js', import.meta.url));
}

export function scanFolderAsync(rootPath: string, extensions?: string[]): Promise<ScannedFile[]> {
  return scanFolderCheckedAsync(rootPath, extensions).then((result) => (result.ok ? result.files : []));
}

export function scanFolderCheckedAsync(rootPath: string, extensions?: string[]): Promise<ScanFolderResult> {
  if (shouldUseSyncScan()) {
    return Promise.resolve(scanFolderChecked(rootPath, extensions));
  }

  return runScanWorker(rootPath, extensions).catch(() => scanFolderChecked(rootPath, extensions));
}

function runScanWorker(rootPath: string, extensions?: string[]): Promise<ScanFolderResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerScriptPath(), {
      workerData: { rootPath, extensions },
    });
    const timeout = setTimeout(() => {
      void worker.terminate();
      reject(new Error('scan_worker_timeout'));
    }, SCAN_WORKER_TIMEOUT_MS);
    worker.once('message', (message: ScanFolderResult) => {
      clearTimeout(timeout);
      void worker.terminate();
      resolve(message);
    });
    worker.once('error', (error) => {
      clearTimeout(timeout);
      void worker.terminate();
      reject(error);
    });
    worker.once('exit', (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(`scan_worker_exit_${code}`));
      } else {
        reject(new Error('scan_worker_exit_without_result'));
      }
    });
  });
}
