import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import type { LocalFolderEntry } from '../../platform/local-folder-config.js';
import type { SearchHit } from '../../platform/knowledge.js';
import { searchLocalFolder, type FolderSearchOptions } from './search.js';

/** A deadline must run on the host even when directory traversal or file I/O stalls. */
export function searchLocalFolderAsync(
  folder: LocalFolderEntry,
  query: string,
  options?: FolderSearchOptions,
  abortSignal?: AbortSignal,
): Promise<SearchHit[]> {
  if (abortSignal?.aborted) return Promise.reject(new Error('folder_search_aborted'));
  if (process.env.VITEST === 'true' && !process.env.AX_SEARCH_WORKER_PATH) {
    return Promise.resolve(searchLocalFolder(folder, query, options));
  }
  return new Promise((resolve, reject) => {
    const worker = new Worker(process.env.AX_SEARCH_WORKER_PATH
      ?? fileURLToPath(new URL('./search-worker.js', import.meta.url)), {
      workerData: { folder, query, options }, resourceLimits: { maxOldGenerationSizeMb: 64 },
    });
    let settled = false;
    const finish = (result?: SearchHit[], error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      abortSignal?.removeEventListener('abort', onAbort);
      void worker.terminate().then(() => {
        if (abortSignal?.aborted) reject(new Error('folder_search_aborted'));
        else if (error) reject(error);
        else resolve(result!);
      }, reject);
    };
    const onAbort = () => finish(undefined, new Error('folder_search_aborted'));
    const timer = setTimeout(() => finish(undefined, new Error('folder_search_timeout')), 30_000);
    abortSignal?.addEventListener('abort', onAbort, { once: true });
    worker.once('message', (hits: SearchHit[]) => finish(hits));
    worker.once('error', () => finish(undefined, new Error('folder_search_worker_failed')));
    worker.once('exit', () => finish(undefined, new Error('folder_search_worker_exited')));
    if (abortSignal?.aborted) onAbort();
  });
}
