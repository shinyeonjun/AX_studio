import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { TableArtifactSchema, type TableArtifact } from '../contracts/artifacts/table.js';
import { WorkbookArtifactSchema, type WorkbookArtifact } from '../contracts/artifacts/workbook.js';
import { assertArtifactId, parseStoredArtifact, readJsonFile, safeFileName } from './artifact/validation.js';
import type { StoredArtifact } from './artifact/contracts.js';
export type { StoredArtifact } from './artifact/contracts.js';

export const MAX_ARTIFACT_BYTES = 50 * 1024 * 1024;

export class ArtifactStore {
  private readonly shaIndex = new Map<string, StoredArtifact>();
  private shaIndexReady = false;

  constructor(private readonly rootDir: string) {
    mkdirSync(rootDir, { recursive: true });
  }

  get root(): string {
    return this.rootDir;
  }

  importFile(sourcePath: string, options: { id?: string; mimeType?: string } = {}): StoredArtifact {
    if (options.id !== undefined) assertArtifactId(options.id);
    const sourceSize = statSync(sourcePath).size;
    if (sourceSize > MAX_ARTIFACT_BYTES) throw new Error('artifact_too_large');
    const buffer = readFileSync(sourcePath);
    if (buffer.byteLength > MAX_ARTIFACT_BYTES) throw new Error('artifact_too_large');
    const sha256 = createHash('sha256').update(buffer).digest('hex');
    const existing = this.findBySha(sha256);
    if (existing) return existing;

    const id = options.id ?? `art_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const fileName = basename(sourcePath);
    const metadataPath = join(this.rootDir, `${id}.json`);
    if (existsSync(metadataPath)) {
      const existingById = this.get(id);
      if (!existingById || existingById.sha256 !== sha256) {
        throw new Error(`Artifact id already exists with different content: ${id}`);
      }
      return existingById;
    }

    const storedPath = join(this.rootDir, `${id}_${fileName}`);
    writeFileSync(storedPath, buffer);
    const record: StoredArtifact = {
      id,
      sha256,
      fileName,
      storedPath,
      mimeType: options.mimeType,
      size: buffer.length,
      createdAt: new Date().toISOString(),
    };
    writeFileSync(metadataPath, JSON.stringify(record));
    this.remember(record);
    return record;
  }

  putBytes(
    data: Uint8Array,
    options: { id?: string; fileName: string; mimeType?: string },
  ): StoredArtifact {
    if (options.id !== undefined) assertArtifactId(options.id);
    if (data.byteLength > MAX_ARTIFACT_BYTES) throw new Error('artifact_too_large');
    const buffer = Buffer.from(data);
    const sha256 = createHash('sha256').update(buffer).digest('hex');
    const existingBySha = this.findBySha(sha256);
    if (existingBySha) return existingBySha;

    const id = options.id ?? `art_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const metadataPath = join(this.rootDir, `${id}.json`);
    if (existsSync(metadataPath)) {
      const existingById = this.get(id);
      if (!existingById || existingById.sha256 !== sha256) {
        throw new Error(`Artifact id already exists with different content: ${id}`);
      }
      return existingById;
    }

    const fileName = safeFileName(options.fileName);
    const storedPath = join(this.rootDir, `${id}_${fileName}`);
    writeFileSync(storedPath, buffer);
    const record: StoredArtifact = {
      id,
      sha256,
      fileName,
      storedPath,
      mimeType: options.mimeType,
      size: buffer.length,
      createdAt: new Date().toISOString(),
    };
    writeFileSync(metadataPath, JSON.stringify(record));
    this.remember(record);
    return record;
  }

  putJson(id: string, value: unknown): void {
    assertArtifactId(id);
    this.forgetById(id);
    writeFileSync(join(this.rootDir, `${id}.json`), JSON.stringify(value));
  }

  putDocumentArtifact(id: string, value: unknown): void {
    assertArtifactId(id);
    writeFileSync(join(this.rootDir, `${id}.document.json`), JSON.stringify(value));
  }

  putIngestResult(id: string, value: unknown): void {
    assertArtifactId(id);
    writeFileSync(join(this.rootDir, `${id}.ingest.json`), JSON.stringify(value));
  }

  /** Compatibility surface for persisted Work Discovery table artifacts. */
  putTableArtifact(id: string, value: TableArtifact): void {
    assertArtifactId(id);
    const parsed = TableArtifactSchema.safeParse(value);
    if (!parsed.success || parsed.data.id !== id) throw new Error('Invalid table artifact');
    this.forgetById(id);
    writeFileSync(join(this.rootDir, `${id}.json`), JSON.stringify(parsed.data));
  }

  /** Compatibility surface for persisted Work Discovery workbook artifacts. */
  putWorkbookArtifact(id: string, value: WorkbookArtifact): void {
    assertArtifactId(id);
    const parsed = WorkbookArtifactSchema.safeParse(value);
    if (!parsed.success || parsed.data.id !== id) throw new Error('Invalid workbook artifact');
    this.forgetById(id);
    writeFileSync(join(this.rootDir, `${id}.json`), JSON.stringify(parsed.data));
  }

  getDocumentArtifact<T>(id: string): T | undefined {
    assertArtifactId(id);
    const metaPath = join(this.rootDir, `${id}.document.json`);
    if (!existsSync(metaPath)) return undefined;
    return readJsonFile<T>(metaPath);
  }

  getIngestResult<T>(id: string): T | undefined {
    assertArtifactId(id);
    const resultPath = join(this.rootDir, `${id}.ingest.json`);
    if (!existsSync(resultPath)) return undefined;
    return readJsonFile<T>(resultPath);
  }

  getTableArtifact(id: string): TableArtifact | undefined {
    const parsed = TableArtifactSchema.safeParse(this.getJson<unknown>(id));
    return parsed.success ? parsed.data : undefined;
  }

  getWorkbookArtifact(id: string): WorkbookArtifact | undefined {
    const parsed = WorkbookArtifactSchema.safeParse(this.getJson<unknown>(id));
    return parsed.success ? parsed.data : undefined;
  }

  getJson<T>(id: string): T | undefined {
    assertArtifactId(id);
    const metaPath = join(this.rootDir, `${id}.json`);
    if (!existsSync(metaPath)) return undefined;
    return readJsonFile<T>(metaPath);
  }

  get(id: string): StoredArtifact | undefined {
    assertArtifactId(id);
    const metaPath = join(this.rootDir, `${id}.json`);
    if (!existsSync(metaPath)) return undefined;
    return parseStoredArtifact(this.rootDir, metaPath);
  }

  /** Delete the stored file plus every sidecar written for this artifact id. */
  remove(id: string): void {
    assertArtifactId(id);
    const record = this.get(id);
    this.forgetById(id);
    if (record?.storedPath) rmSync(record.storedPath, { force: true });
    for (const suffix of ['.json', '.document.json', '.ingest.json']) {
      rmSync(join(this.rootDir, `${id}${suffix}`), { force: true });
    }
  }

  findBySha(sha256: string): StoredArtifact | undefined {
    this.loadShaIndex();
    return this.shaIndex.get(sha256);
  }

  private loadShaIndex(): void {
    if (this.shaIndexReady) return;
    // ponytail: one metadata scan per store, then O(1) dedup lookups; a shared
    // multi-process artifact directory would need an explicit invalidation strategy.
    for (const name of readdirSync(this.rootDir)) {
      if (!name.endsWith('.json')) continue;
      const record = parseStoredArtifact(this.rootDir, join(this.rootDir, name));
      if (!record) continue;
      this.shaIndex.set(record.sha256, record);
    }
    this.shaIndexReady = true;
  }

  private remember(record: StoredArtifact): void {
    this.shaIndex.set(record.sha256, record);
  }

  private forgetById(id: string): void {
    for (const [sha256, record] of this.shaIndex) {
      if (record.id === id) this.shaIndex.delete(sha256);
    }
  }
}
