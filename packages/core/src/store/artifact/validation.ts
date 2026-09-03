import { readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import type { StoredArtifact } from './contracts.js';

function isWithinRoot(rootDir: string, path: string): boolean {
  const relativePath = relative(resolve(rootDir), resolve(path));
  return (
    relativePath !== '' &&
    relativePath !== '..' &&
    !relativePath.startsWith(`..${sep}`) &&
    !isAbsolute(relativePath)
  );
}

function readJsonFile<T>(path: string): T | undefined {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return undefined;
  }
}

export function parseStoredArtifact(rootDir: string, path: string): StoredArtifact | undefined {
  const value = readJsonFile<Partial<StoredArtifact> | null>(path);
  if (
    !value ||
    typeof value.id !== 'string' ||
    typeof value.sha256 !== 'string' ||
    typeof value.fileName !== 'string' ||
    typeof value.storedPath !== 'string' ||
    typeof value.size !== 'number' ||
    typeof value.createdAt !== 'string' ||
    (value.mimeType !== undefined && typeof value.mimeType !== 'string') ||
    !isWithinRoot(rootDir, value.storedPath)
  ) {
    return undefined;
  }
  return value as StoredArtifact;
}

export function assertArtifactId(id: string): void {
  if (!id || id === '.' || id === '..' || id.includes('/') || id.includes('\\')) {
    throw new Error(`Invalid artifact id: ${JSON.stringify(id)}`);
  }
}

export function safeFileName(fileName: string): string {
  const leaf = fileName.replace(/^.*[\\/]/, '');
  const sanitized = leaf
    .replace(/[\u0000-\u001f\u007f]/g, '_')
    .replace(/[<>:"|?*]/g, '_')
    .trim()
    .replace(/[. ]+$/g, '');
  return sanitized && sanitized !== '.' && sanitized !== '..' ? sanitized.slice(0, 180) : 'artifact.bin';
}

export { readJsonFile };
