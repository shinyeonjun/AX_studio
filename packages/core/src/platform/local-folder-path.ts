import { realpathSync, statSync } from 'node:fs';
import { isAbsolute, normalize, relative, resolve } from 'node:path';

export interface ResolvedFolderPath {
  ok: true;
  path: string;
  rootReal: string;
}

export interface ResolvedFolderPathError {
  ok: false;
  error: string;
  errorCode: string;
}

export type ResolveFolderPathResult = ResolvedFolderPath | ResolvedFolderPathError;

function normalizeForCompare(path: string): string {
  const normalized = normalize(path);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

/** Whether `targetReal` stays inside `rootReal` after normalization. */
export function isPathContainedInRoot(rootReal: string, targetReal: string): boolean {
  const rel = relative(normalizeForCompare(rootReal), normalizeForCompare(targetReal));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

export function resolveFolderRoot(folderPath: string): ResolveFolderPathResult {
  try {
    const rootReal = realpathSync(folderPath);
    const stat = statSync(rootReal);
    if (!stat.isDirectory()) {
      return { ok: false, error: 'folder_not_directory', errorCode: 'folder_not_directory' };
    }
    return { ok: true, path: folderPath, rootReal };
  } catch {
    return { ok: false, error: 'folder_not_accessible', errorCode: 'folder_not_accessible' };
  }
}

export function resolveFileWithinFolderRoot(
  folderPath: string,
  candidatePath: string,
): ResolveFolderPathResult {
  const root = resolveFolderRoot(folderPath);
  if (!root.ok) return root;

  const absoluteCandidate = isAbsolute(candidatePath)
    ? candidatePath
    : resolve(root.path, candidatePath);

  let targetReal: string;
  try {
    targetReal = realpathSync(absoluteCandidate);
    const stat = statSync(targetReal);
    if (!stat.isFile()) {
      return { ok: false, error: 'not_a_file', errorCode: 'not_a_file' };
    }
  } catch {
    return { ok: false, error: 'file_not_accessible', errorCode: 'file_not_accessible' };
  }

  if (!isPathContainedInRoot(root.rootReal, targetReal)) {
    return { ok: false, error: 'path_outside_source', errorCode: 'path_outside_source' };
  }

  return { ok: true, path: targetReal, rootReal: root.rootReal };
}
