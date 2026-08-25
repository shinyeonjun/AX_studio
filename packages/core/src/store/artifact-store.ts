import { createHash, randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

export interface StoredArtifact {
  id: string;
  sha256: string;
  fileName: string;
  storedPath: string;
  mimeType?: string;
  size: number;
  createdAt: string;
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

    const id = options.id ?? `art_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
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
    writeFileSync(join(this.rootDir, `${id}.json`), JSON.stringify(record));
    return record;
  }

  putJson(id: string, value: unknown): void {
    writeFileSync(join(this.rootDir, `${id}.json`), JSON.stringify(value));
  }

  putDocumentArtifact(id: string, value: unknown): void {
    writeFileSync(join(this.rootDir, `${id}.document.json`), JSON.stringify(value));
  }

  putIngestResult(id: string, value: unknown): void {
    writeFileSync(join(this.rootDir, `${id}.ingest.json`), JSON.stringify(value));
  }

  getDocumentArtifact<T>(id: string): T | undefined {
    const metaPath = join(this.rootDir, `${id}.document.json`);
    if (!existsSync(metaPath)) return undefined;
    return JSON.parse(readFileSync(metaPath, 'utf8')) as T;
  }

  getIngestResult<T>(id: string): T | undefined {
    const resultPath = join(this.rootDir, `${id}.ingest.json`);
    if (!existsSync(resultPath)) return undefined;
    return JSON.parse(readFileSync(resultPath, 'utf8')) as T;
  }

  getJson<T>(id: string): T | undefined {
    const metaPath = join(this.rootDir, `${id}.json`);
    if (!existsSync(metaPath)) return undefined;
    return JSON.parse(readFileSync(metaPath, 'utf8')) as T;
  }

  get(id: string): StoredArtifact | undefined {
    const metaPath = join(this.rootDir, `${id}.json`);
    if (!existsSync(metaPath)) return undefined;
    const record = JSON.parse(readFileSync(metaPath, 'utf8')) as StoredArtifact;
    if (!record.storedPath) return undefined;
    return record;
  }

  /** Delete the stored file plus every sidecar written for this artifact id. */
  remove(id: string): void {
    const record = this.get(id);
    if (record?.storedPath) rmSync(record.storedPath, { force: true });
    for (const suffix of ['.json', '.document.json', '.ingest.json']) {
      rmSync(join(this.rootDir, `${id}${suffix}`), { force: true });
    }
  }

  findBySha(sha256: string): StoredArtifact | undefined {
    for (const name of readdirSync(this.rootDir)) {
      if (!name.endsWith('.json')) continue;
      const record = JSON.parse(readFileSync(join(this.rootDir, name), 'utf8')) as StoredArtifact;
      if (record.sha256 === sha256) return record;
    }
    return undefined;
  }
}
