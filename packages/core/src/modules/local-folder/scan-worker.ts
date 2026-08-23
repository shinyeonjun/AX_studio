import { parentPort, workerData } from 'node:worker_threads';
import { lstatSync, readdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import { isPathContainedInRoot, resolveFolderRoot } from './path-security.js';
import type { ScannedFile } from './scan.js';
import { MAX_FILES_PER_SCAN } from './scan.js';

interface ScanWorkerInput {
  rootPath: string;
  extensions?: string[];
}

interface ScanWorkerOutput {
  ok: true;
  files: ScannedFile[];
}

interface ScanWorkerError {
  ok: false;
  error: string;
  errorCode: string;
}

function normalizeExtensions(extensions?: string[]): Set<string> | null {
  if (!extensions?.length) return null;
  return new Set(
    extensions.map((ext) => {
      const trimmed = ext.trim().toLowerCase();
      return trimmed.startsWith('.') ? trimmed : `.${trimmed}`;
    }),
  );
}

function walkDirectory(
  rootReal: string,
  currentPath: string,
  allowed: Set<string> | null,
  out: ScannedFile[],
): void {
  if (out.length >= MAX_FILES_PER_SCAN) return;

  let entries: string[];
  try {
    entries = readdirSync(currentPath);
  } catch {
    return;
  }

  for (const name of entries) {
    if (out.length >= MAX_FILES_PER_SCAN) break;
    const filePath = join(currentPath, name);
    let stat;
    try {
      stat = lstatSync(filePath);
    } catch {
      continue;
    }

    if (stat.isSymbolicLink()) continue;

    if (stat.isDirectory()) {
      if (!isPathContainedInRoot(rootReal, filePath)) continue;
      walkDirectory(rootReal, filePath, allowed, out);
      continue;
    }
    if (!stat.isFile()) continue;
    if (!isPathContainedInRoot(rootReal, filePath)) continue;

    const extension = extname(name).toLowerCase();
    if (allowed && !allowed.has(extension)) continue;

    out.push({
      key: filePath,
      filePath,
      fileName: name,
      extension,
      size: stat.size,
      modifiedAt: stat.mtime.toISOString(),
    });
  }
}

function runScan(input: ScanWorkerInput): ScanWorkerOutput | ScanWorkerError {
  const root = resolveFolderRoot(input.rootPath);
  if (!root.ok) return root;

  const allowed = normalizeExtensions(input.extensions);
  const files: ScannedFile[] = [];
  walkDirectory(root.rootReal, root.rootReal, allowed, files);
  return { ok: true, files };
}

if (parentPort) {
  const input = workerData as ScanWorkerInput;
  parentPort.postMessage(runScan(input));
}
