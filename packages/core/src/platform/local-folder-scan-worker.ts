import { parentPort, workerData } from 'node:worker_threads';
import { scanFolderChecked, type ScanFolderResult } from './local-folder-scan.js';

interface ScanWorkerInput {
  rootPath: string;
  extensions?: string[];
}

function runScan(input: ScanWorkerInput): ScanFolderResult {
  return scanFolderChecked(input.rootPath, input.extensions);
}

if (parentPort) {
  const input = workerData as ScanWorkerInput;
  parentPort.postMessage(runScan(input));
}
