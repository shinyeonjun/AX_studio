import { createHash, randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { DocumentArtifactSchema, type DocumentArtifact } from '../contracts/artifacts/document.js';
import { TableArtifactSchema, type TableArtifact } from '../contracts/artifacts/table.js';
import { WorkbookArtifactSchema, type WorkbookArtifact } from '../contracts/artifacts/workbook.js';
import { IngestDocumentResultSchema } from '../document-engine/schema.js';
import type { IngestDocumentResult } from '../document-engine/types.js';

export interface StoredArtifact {
  id: string;
  sha256: string;
  fileName: string;
  storedPath: string;
  mimeType?: string;
  size: number;
  createdAt: string;
}

const ARTIFACT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/;

function isArtifactId(value: unknown): value is string {
  return typeof value === 'string' && ARTIFACT_ID_PATTERN.test(value);
}

function assertArtifactId(value: string): string {
  if (!isArtifactId(value)) throw new Error('invalid_artifact_id');
  return value;
}

function isWithinRoot(rootDir: string, filePath: string): boolean {
  const root = resolve(rootDir);
  const candidate = resolve(filePath);
  const child = relative(root, candidate);
  return child !== '' && child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child);
}

function artifactJsonPath(rootDir: string, id: string, suffix = ''): string | undefined {
  if (!isArtifactId(id)) return undefined;
  return join(rootDir, `${id}${suffix}.json`);
}

function parseStoredArtifact(path: string, rootDir: string): StoredArtifact | undefined {
  const value = readJsonFile<Partial<StoredArtifact> | null>(path);
  if (
    !value ||
    !isArtifactId(value.id) ||
    typeof value.id !== 'string' ||
    typeof value.sha256 !== 'string' ||
    typeof value.fileName !== 'string' ||
    typeof value.storedPath !== 'string' ||
    !isWithinRoot(rootDir, value.storedPath) ||
    typeof value.size !== 'number' ||
    typeof value.createdAt !== 'string' ||
    (value.mimeType !== undefined && typeof value.mimeType !== 'string')
  ) {
    return undefined;
  }
  return value as StoredArtifact;
}

function readJsonFile<T>(path: string): T | undefined {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return undefined;
  }
}

function writeJsonFile(path: string, value: unknown, errorCode = 'invalid_artifact_json'): void {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new Error(errorCode);
  }
  if (serialized === undefined) throw new Error(errorCode);
  writeFileSync(path, serialized, 'utf8');
}

function parseTyped<T>(path: string | undefined, schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } }): T | undefined {
  if (!path || !existsSync(path)) return undefined;
  const parsed = schema.safeParse(readJsonFile<unknown>(path));
  return parsed.success ? parsed.data : undefined;
}

export class ArtifactStore {
  constructor(private readonly rootDir: string) {
    mkdirSync(rootDir, { recursive: true });
  }

  get root(): string {
    return this.rootDir;
  }

  importFile(sourcePath: string, options: { id?: string; mimeType?: string } = {}): StoredArtifact {
    const buffer = readFileSync(sourcePath);
    const sha256 = createHash('sha256').update(buffer).digest('hex');
    const existing = this.findBySha(sha256);
    if (existing) return existing;

    const id = assertArtifactId(options.id ?? `art_${randomUUID().replace(/-/g, '').slice(0, 16)}`);
    const fileName = basename(sourcePath);
    const storedPath = join(this.rootDir, `${id}_${fileName}`);
    if (!existsSync(storedPath)) {
      copyFileSync(sourcePath, storedPath);
    }
    const record: StoredArtifact = {
      id,
      sha256,
      fileName,
      storedPath,
      mimeType: options.mimeType,
      size: buffer.length,
      createdAt: new Date().toISOString(),
    };
    writeJsonFile(join(this.rootDir, `${id}.json`), record);
    return record;
  }

  putJson(id: string, value: unknown): void {
    const safeId = assertArtifactId(id);
    writeJsonFile(join(this.rootDir, `${safeId}.json`), value);
  }

  putDocumentArtifact(id: string, value: unknown): void {
    const safeId = assertArtifactId(id);
    const parsed = DocumentArtifactSchema.safeParse(value);
    if (!parsed.success) throw new Error('invalid_document_artifact');
    if (parsed.data.id !== safeId) throw new Error('artifact_id_mismatch');
    writeJsonFile(join(this.rootDir, `${safeId}.document.json`), parsed.data);
  }

  putIngestResult(id: string, value: unknown): void {
    const safeId = assertArtifactId(id);
    const parsed = IngestDocumentResultSchema.safeParse(value);
    if (!parsed.success) throw new Error('invalid_ingest_result');
    writeJsonFile(join(this.rootDir, `${safeId}.ingest.json`), parsed.data);
  }

  putTableArtifact(id: string, value: unknown): void {
    const safeId = assertArtifactId(id);
    const parsed = TableArtifactSchema.safeParse(value);
    if (!parsed.success) throw new Error('invalid_table_artifact');
    if (parsed.data.id !== safeId) throw new Error('artifact_id_mismatch');
    writeJsonFile(join(this.rootDir, `${safeId}.json`), parsed.data);
  }

  putWorkbookArtifact(id: string, value: unknown): void {
    const safeId = assertArtifactId(id);
    const parsed = WorkbookArtifactSchema.safeParse(value);
    if (!parsed.success) throw new Error('invalid_workbook_artifact');
    if (parsed.data.id !== safeId) throw new Error('artifact_id_mismatch');
    writeJsonFile(join(this.rootDir, `${safeId}.json`), parsed.data);
  }

  getDocumentArtifact(id: string): DocumentArtifact | undefined {
    return parseTyped(artifactJsonPath(this.rootDir, id, '.document'), DocumentArtifactSchema);
  }

  getIngestResult(id: string): IngestDocumentResult | undefined {
    return parseTyped(artifactJsonPath(this.rootDir, id, '.ingest'), IngestDocumentResultSchema);
  }

  getTableArtifact(id: string): TableArtifact | undefined {
    return parseTyped(artifactJsonPath(this.rootDir, id), TableArtifactSchema);
  }

  getWorkbookArtifact(id: string): WorkbookArtifact | undefined {
    return parseTyped(artifactJsonPath(this.rootDir, id), WorkbookArtifactSchema);
  }

  getJson<T>(id: string): T | undefined {
    const metaPath = artifactJsonPath(this.rootDir, id);
    if (!metaPath || !existsSync(metaPath)) return undefined;
    return readJsonFile<T>(metaPath);
  }

  get(id: string): StoredArtifact | undefined {
    const metaPath = artifactJsonPath(this.rootDir, id);
    if (!metaPath || !existsSync(metaPath)) return undefined;
    return parseStoredArtifact(metaPath, this.rootDir);
  }

  /** Delete the stored file plus every sidecar written for this artifact id. */
  remove(id: string): void {
    if (!isArtifactId(id)) return;
    const record = this.get(id);
    if (record?.storedPath) rmSync(record.storedPath, { force: true });
    for (const suffix of ['.json', '.document.json', '.ingest.json']) {
      rmSync(join(this.rootDir, `${id}${suffix}`), { force: true });
    }
  }

  findBySha(sha256: string): StoredArtifact | undefined {
    for (const name of readdirSync(this.rootDir)) {
      if (!name.endsWith('.json')) continue;
      const record = parseStoredArtifact(join(this.rootDir, name), this.rootDir);
      if (!record) continue;
      if (record.sha256 === sha256) return record;
    }
    return undefined;
  }
}
