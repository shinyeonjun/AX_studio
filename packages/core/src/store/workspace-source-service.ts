import { randomUUID } from 'node:crypto';
import { extname, join } from 'node:path';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import type { DocumentArtifact } from '../contracts/artifacts/document.js';
import type { IngestDocumentResult } from '../document-engine/types.js';
import type { WorkflowStore } from './workflow-store.js';
import { ArtifactStore } from './artifact-store.js';
import { importDiscoveryArtifact } from './import-discovery-artifact.js';
import { WorkspaceSourceIngestQueue } from './workspace-source-ingest-queue.js';
import * as sourceRepo from './repositories/workspace-source-repository.js';

export type WorkspaceSourceStatus = sourceRepo.WorkspaceSourceStatus;
export type WorkspaceSourceSummary = sourceRepo.WorkspaceSourceSummary;
export type WorkspaceSourceRecord = sourceRepo.WorkspaceSourceRecord;

export interface WorkspaceSourceDocument {
  id: string;
  engine?: string;
  text?: string;
  pages: Array<{
    index: number;
    text?: string;
    hasVisual?: boolean;
    sourceType?: string;
    ocrApplied?: boolean;
    ocrConfidence?: number | null;
  }>;
  images: Array<{ id: string; pageIndex: number; ocrText?: string; ocrConfidence?: number | null }>;
  tables: Array<{ id: string; pageIndex: number; text?: string }>;
}

export interface WorkspaceSourceReadResult {
  source: WorkspaceSourceRecord;
  document: WorkspaceSourceDocument;
}

export class WorkspaceSourceError extends Error {
  constructor(public readonly code: string, message = code) {
    super(message);
    this.name = 'WorkspaceSourceError';
  }
}

function assertSessionId(sessionId: string): string {
  const value = sessionId.trim();
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw new WorkspaceSourceError('invalid_workspace_session');
  return value;
}

function sourceId(): string {
  return `src_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
}

function errorCode(error: unknown): string {
  const candidate = error instanceof WorkspaceSourceError
    ? error.code
    : error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
      ? error.code
      : (error instanceof Error ? error.message : String(error)).split(':', 1)[0];
  return /^[a-z][a-z0-9_.-]{0,96}$/i.test(candidate)
    ? candidate
    : 'workspace_source_ingest_failed';
}

function errorMessage(code: string): string {
  if (code === 'document_engine_worker_missing') return '문서 엔진을 찾을 수 없습니다.';
  if (code === 'document_engine_timeout') return '문서 분석 시간이 초과되었습니다.';
  if (code === 'workspace_source_artifact_missing') return '업로드한 원본 파일을 찾을 수 없습니다.';
  return '문서 분석에 실패했습니다.';
}

function summaryFrom(
  result: IngestDocumentResult | undefined,
  document: DocumentArtifact | undefined,
): WorkspaceSourceSummary | undefined {
  if (result?.summary) return result.summary;
  if (!document) return undefined;
  return {
    pageCount: document.pageCount ?? document.pages.length,
    chunkCount: document.chunkCount ?? 0,
    tableCount: document.tableCount ?? document.tables.length,
    imageCount: document.imageCount ?? document.images.length,
    visualPageCount: document.pages.filter((page) => page.hasVisual).length,
    visualPages: document.pages.filter((page) => page.hasVisual).map((page) => page.index),
    engine: document.engine ?? 'document-engine',
  };
}

function publicDocument(document: DocumentArtifact): WorkspaceSourceDocument {
  return {
    id: document.id,
    ...(document.engine ? { engine: document.engine } : {}),
    ...(document.text ? { text: document.text } : {}),
    pages: document.pages.map((page) => ({
      index: page.index,
      ...(page.text ? { text: page.text } : {}),
      ...(page.hasVisual !== undefined ? { hasVisual: page.hasVisual } : {}),
      ...(page.sourceType ? { sourceType: page.sourceType } : {}),
      ...(page.ocrApplied !== undefined ? { ocrApplied: page.ocrApplied } : {}),
      ...(page.ocrConfidence !== undefined ? { ocrConfidence: page.ocrConfidence } : {}),
    })),
    images: document.images.map((image) => ({
      id: image.id,
      pageIndex: image.pageIndex,
      ...(image.ocrText ? { ocrText: image.ocrText } : {}),
      ...(image.ocrConfidence !== undefined ? { ocrConfidence: image.ocrConfidence } : {}),
    })),
    tables: document.tables.map((table) => ({
      id: table.id,
      pageIndex: table.pageIndex,
      ...(table.text ? { text: table.text } : {}),
    })),
  };
}

function boundedDocument(document: DocumentArtifact, maxChars: number): WorkspaceSourceDocument {
  const value = publicDocument(document);
  let remaining = maxChars;
  const take = (text: string | undefined): string | undefined => {
    if (!text || remaining <= 0) return undefined;
    const selected = text.slice(0, remaining);
    remaining -= selected.length;
    return selected;
  };

  // The flattened text and page text often contain the same content. Reserve
  // part of the budget for page-local evidence so the agent can still cite a
  // page without allowing one source to expand beyond the command contract.
  const textBudget = value.text ? Math.max(1, Math.floor(maxChars * 0.6)) : 0;
  const text = value.text?.slice(0, textBudget);
  remaining -= text?.length ?? 0;
  const pages = value.pages.map((page) => {
    const pageText = take(page.text);
    const { text: _pageText, ...pageMetadata } = page;
    return pageText ? { ...pageMetadata, text: pageText } : pageMetadata;
  });
  const images = value.images.map((image) => {
    const ocrText = take(image.ocrText);
    const { ocrText: _imageText, ...imageMetadata } = image;
    return ocrText ? { ...imageMetadata, ocrText } : imageMetadata;
  });
  const tables = value.tables.map((table) => {
    const tableText = take(table.text);
    const { text: _tableText, ...tableMetadata } = table;
    return tableText ? { ...tableMetadata, text: tableText } : tableMetadata;
  });
  return {
    ...value,
    ...(text ? { text } : {}),
    pages,
    images,
    tables,
  };
}

function manifestSource(source: WorkspaceSourceRecord) {
  return source;
}

export class WorkspaceSourceService {
  private readonly ingestQueue = new WorkspaceSourceIngestQueue();
  private readonly listeners = new Set<(source: WorkspaceSourceRecord) => void>();

  constructor(
    private readonly store: WorkflowStore,
    private readonly artifactStore: ArtifactStore,
    private readonly sessionsRoot: string,
  ) {
    mkdirSync(sessionsRoot, { recursive: true });
    queueMicrotask(() => void this.resumePendingSources().catch(() => undefined));
  }

  list(sessionId: string): WorkspaceSourceRecord[] {
    return this.store.listWorkspaceSources(assertSessionId(sessionId));
  }

  subscribe(listener: (source: WorkspaceSourceRecord) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  waitForIdle(): Promise<void> {
    return this.ingestQueue.waitForIdle();
  }

  async attachFile(sessionId: string, filePath: string, mimeType?: string): Promise<WorkspaceSourceRecord> {
    const safeSessionId = assertSessionId(sessionId);
    if (!this.store.getWorkspaceChat(safeSessionId)) {
      throw new WorkspaceSourceError('workspace_chat_not_found');
    }
    const stored = this.artifactStore.importFile(filePath, { mimeType });
    const id = sourceId();
    const now = new Date().toISOString();
    let source = this.store.insertWorkspaceSource({
      id,
      sessionId: safeSessionId,
      artifactId: stored.id,
      fileName: stored.fileName,
      ...(stored.mimeType ? { mimeType: stored.mimeType } : {}),
      status: 'processing',
      createdAt: now,
      updatedAt: now,
    });
    this.writeManifest(source);
    this.notify(source);

    if (extname(stored.fileName).toLowerCase() === '.pdf') {
      this.ingestQueue.enqueue(id, () => this.ingestPdf({
        id,
        sessionId: safeSessionId,
        artifactId: stored.id,
        storedPath: stored.storedPath,
      }));
    } else {
      source = this.store.updateWorkspaceSource(id, {
        status: 'ready',
        updatedAt: new Date().toISOString(),
      }) ?? source;
      this.writeManifest(source);
      this.notify(source);
    }
    this.store.refreshWorkspaceChatTitle(safeSessionId);
    return source;
  }

  async attachToSession(
    sessionId: string | undefined,
    filePath: string,
    mimeType?: string,
  ): Promise<{ sessionId: string; source: WorkspaceSourceRecord; title: string }> {
    let safeSessionId = sessionId ? assertSessionId(sessionId) : undefined;
    if (safeSessionId && !this.store.getWorkspaceChat(safeSessionId)) {
      throw new WorkspaceSourceError('workspace_chat_not_found');
    }
    if (!safeSessionId) {
      safeSessionId = this.store.saveWorkspaceChat({ messages: [] }).id;
    }
    const source = await this.attachFile(safeSessionId, filePath, mimeType);
    const title = this.store.refreshWorkspaceChatTitle(safeSessionId) ?? source.fileName;
    return { sessionId: safeSessionId, source, title };
  }

  read(sessionId: string, id: string, maxChars = 20_000): WorkspaceSourceReadResult {
    const source = this.store.getWorkspaceSource(assertSessionId(sessionId), id.trim());
    if (!source) throw new WorkspaceSourceError('workspace_source_not_found');
    if (source.status === 'processing') throw new WorkspaceSourceError('workspace_source_processing');
    if (source.status === 'failed') throw new WorkspaceSourceError(source.errorCode ?? 'workspace_source_failed');
    const document = source.documentArtifactId
      ? this.artifactStore.getDocumentArtifact(source.documentArtifactId)
      : undefined;
    if (!document) throw new WorkspaceSourceError('workspace_source_document_missing');
    const bounded = Number.isFinite(maxChars)
      ? Math.max(1_000, Math.min(20_000, Math.trunc(maxChars)))
      : 20_000;
    const value = boundedDocument(document, bounded);
    return {
      source,
      document: value,
    };
  }

  removeSession(sessionId: string): void {
    const safeSessionId = assertSessionId(sessionId);
    // GC artifacts this session imported, unless another session still
    // references the same content (importFile dedupes by sha).
    const artifactIds = new Set<string>();
    for (const source of this.store.listWorkspaceSources(safeSessionId)) {
      artifactIds.add(source.artifactId);
      if (source.documentArtifactId) artifactIds.add(source.documentArtifactId);
    }
    for (const artifactId of artifactIds) {
      if (this.store.countWorkspaceSourcesForArtifact(artifactId, safeSessionId) > 0) continue;
      try {
        this.artifactStore.remove(artifactId);
      } catch {
        // Losing a GC pass must not block session deletion.
      }
    }
    rmSync(join(this.sessionsRoot, safeSessionId), { recursive: true, force: true });
  }

  private async ingestPdf(job: {
    id: string;
    sessionId: string;
    artifactId: string;
    storedPath: string;
  }): Promise<void> {
    try {
      await importDiscoveryArtifact(this.artifactStore, job.storedPath);
      const document = this.artifactStore.getDocumentArtifact(job.artifactId);
      if (!document) throw new WorkspaceSourceError('document_ingest_missing_result');
      const ingested = this.artifactStore.getIngestResult(job.artifactId);
      const source = this.store.updateWorkspaceSource(job.id, {
        status: 'ready',
        engine: ingested?.engine ?? document.engine,
        documentArtifactId: job.artifactId,
        summary: summaryFrom(ingested, document),
        errorCode: undefined,
        errorMessage: undefined,
        updatedAt: new Date().toISOString(),
      });
      if (!source) return;
      this.writeManifest(source);
      this.store.refreshWorkspaceChatTitle(job.sessionId);
      this.notify(source);
    } catch (error) {
      const code = errorCode(error);
      const source = this.store.updateWorkspaceSource(job.id, {
        status: 'failed',
        errorCode: code,
        errorMessage: errorMessage(code),
        updatedAt: new Date().toISOString(),
      });
      if (!source) return;
      this.writeManifest(source);
      this.store.refreshWorkspaceChatTitle(job.sessionId);
      this.notify(source);
    }
  }

  private async resumePendingSources(): Promise<void> {
    for (const chat of this.store.listWorkspaceChats()) {
      for (const source of this.store.listWorkspaceSources(chat.id)) {
        if (source.status !== 'processing') continue;
        const artifact = this.artifactStore.get(source.artifactId);
        if (!artifact || !existsSync(artifact.storedPath)) {
          const failed = this.store.updateWorkspaceSource(source.id, {
            status: 'failed',
            errorCode: 'workspace_source_artifact_missing',
            errorMessage: errorMessage('workspace_source_artifact_missing'),
            updatedAt: new Date().toISOString(),
          });
          if (failed) {
            this.writeManifest(failed);
            this.notify(failed);
          }
          continue;
        }
        this.ingestQueue.enqueue(source.id, () => this.ingestPdf({
          id: source.id,
          sessionId: source.sessionId,
          artifactId: source.artifactId,
          storedPath: artifact.storedPath,
        }));
      }
    }
  }

  private notify(source: WorkspaceSourceRecord): void {
    for (const listener of this.listeners) {
      try {
        listener(source);
      } catch {
        // Observers must not change source persistence or queue outcomes.
      }
    }
  }

  private writeManifest(source: WorkspaceSourceRecord): void {
    const sourceDir = join(this.sessionsRoot, source.sessionId, 'sources', source.id);
    mkdirSync(sourceDir, { recursive: true });
    writeFileSync(join(sourceDir, 'manifest.json'), JSON.stringify({ source: manifestSource(source) }, null, 2));
    if (source.status !== 'ready' || !source.documentArtifactId) return;
    const document = this.artifactStore.getDocumentArtifact(source.documentArtifactId);
    if (!document) return;
    writeFileSync(join(sourceDir, 'docling.json'), JSON.stringify({
      sourceId: source.id,
      artifactId: source.artifactId,
      document: publicDocument(document),
    }, null, 2));
  }
}
