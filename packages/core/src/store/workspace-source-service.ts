import { extname } from 'node:path';
import { mkdirSync } from 'node:fs';
import type { DocumentArtifact } from '../contracts/artifacts/document.js';
import type { WorkflowStore } from './workflow-store.js';
import { ArtifactStore } from './artifact-store.js';
import { WorkspaceSourceIngestQueue } from './workspace-source-ingest-queue.js';
import {
  WorkspaceSourceError,
  type WorkspaceSourceDocument,
  type WorkspaceSourceReadResult,
  type WorkspaceSourceRecord,
  type WorkspaceSourceStatus,
  type WorkspaceSourceSummary,
} from './workspace-source/contracts.js';
import {
  assertSessionId,
  sourceId,
} from './workspace-source/validation.js';
import { boundedDocument } from './workspace-source/document.js';
import {
  enqueuePdfIngestion,
  resumePendingSources,
  type WorkspaceSourceIngestJob,
  type WorkspaceSourceIngestionContext,
} from './workspace-source/ingestion.js';
import { removeSessionArtifacts, writeSourceManifest } from './workspace-source/persistence.js';

export type {
  WorkspaceSourceDocument,
  WorkspaceSourceReadResult,
  WorkspaceSourceRecord,
  WorkspaceSourceStatus,
  WorkspaceSourceSummary,
} from './workspace-source/contracts.js';
export { WorkspaceSourceError } from './workspace-source/contracts.js';

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
      this.enqueuePdf({
        id,
        sessionId: safeSessionId,
        artifactId: stored.id,
        storedPath: stored.storedPath,
      });
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
      ? this.artifactStore.getDocumentArtifact<DocumentArtifact>(source.documentArtifactId)
      : undefined;
    if (!document) throw new WorkspaceSourceError('workspace_source_document_missing');
    const bounded = Number.isFinite(maxChars)
      ? Math.max(1_000, Math.min(20_000, Math.trunc(maxChars)))
      : 20_000;
    return {
      source,
      document: boundedDocument(document, bounded),
    };
  }

  /** Resolve an uploaded source only inside its owning session. Physical paths never enter agent commands. */
  resolveStoredFile(sessionId: string, id: string) {
    const source = this.store.getWorkspaceSource(assertSessionId(sessionId), id.trim());
    if (!source) throw new WorkspaceSourceError('workspace_source_not_found');
    if (source.status === 'processing') throw new WorkspaceSourceError('workspace_source_processing');
    if (source.status === 'failed') throw new WorkspaceSourceError(source.errorCode ?? 'workspace_source_failed');
    const artifact = this.artifactStore.get(source.artifactId);
    if (!artifact) throw new WorkspaceSourceError('workspace_source_artifact_missing');
    return { source, artifact };
  }

  removeSession(sessionId: string): void {
    const safeSessionId = assertSessionId(sessionId);
    // GC artifacts this session imported, unless another session still
    // references the same content (importFile dedupes by sha).
    removeSessionArtifacts(this.store, this.artifactStore, this.sessionsRoot, safeSessionId);
  }

  private async resumePendingSources(): Promise<void> {
    await resumePendingSources(this.ingestionContext());
  }

  private enqueuePdf(job: WorkspaceSourceIngestJob): void {
    enqueuePdfIngestion(this.ingestionContext(), job);
  }

  private ingestionContext(): WorkspaceSourceIngestionContext {
    return {
      store: this.store,
      artifactStore: this.artifactStore,
      ingestQueue: this.ingestQueue,
      writeManifest: (source) => this.writeManifest(source),
      notify: (source) => this.notify(source),
    };
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
    writeSourceManifest(this.sessionsRoot, this.artifactStore, source);
  }
}
