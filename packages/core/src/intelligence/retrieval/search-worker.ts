import { parentPort, workerData } from 'node:worker_threads';
import type { LocalFolderEntry } from '../../platform/local-folder-config.js';
import { searchLocalFolder, type FolderSearchOptions } from './search.js';

const input = workerData as { folder: LocalFolderEntry; query: string; options?: FolderSearchOptions };
if (parentPort) parentPort.postMessage(searchLocalFolder(input.folder, input.query, input.options));
