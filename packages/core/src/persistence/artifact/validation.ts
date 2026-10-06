import { readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import type { StoredArtifact } from './contracts.js';
import { MAX_FILE_NAME_UTF8_BYTES, truncateToUtf8Bytes } from '../../platform/file-name-bytes.js';

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
  if (!sanitized || sanitized === '.' || sanitized === '..') return 'artifact.bin';
  return truncateFileName(sanitized, MAX_FILE_NAME_LENGTH);
}

// Stored as `${id}_${name}` under the data root; stays well inside NTFS's
// 255-unit component limit and leaves headroom for deep data-root paths.
const MAX_FILE_NAME_LENGTH = 120;

/** Fits both the character cap and the UTF-8 byte budget (ext4/APFS limit by bytes). */
function fitName(text: string, maxChars: number, maxBytes: number): string {
  return truncateToUtf8Bytes(Array.from(text).slice(0, maxChars).join(''), maxBytes);
}

/** Truncates by code point and keeps a short extension so type detection survives. */
function truncateFileName(name: string, max: number): string {
  if (Array.from(name).length <= max && Buffer.byteLength(name, 'utf8') <= MAX_FILE_NAME_UTF8_BYTES) return name;
  const dot = name.lastIndexOf('.');
  const extension = dot > 0 ? name.slice(dot) : '';
  const extensionChars = Array.from(extension).length;
  if (extensionChars > 1 && extensionChars <= 16) {
    const stem = fitName(name.slice(0, dot), max - extensionChars,
      MAX_FILE_NAME_UTF8_BYTES - Buffer.byteLength(extension, 'utf8')).replace(/[. ]+$/g, '');
    return (stem || 'artifact') + extension;
  }
  return fitName(name, max, MAX_FILE_NAME_UTF8_BYTES).replace(/[. ]+$/g, '') || 'artifact.bin';
}

export { readJsonFile };
