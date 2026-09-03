import { existsSync } from 'node:fs';
import type { DocumentArtifact } from '../../contracts/artifacts/document.js';
import type { IngestDocumentResult } from '../../document-engine/types.js';
import type { ArtifactStore } from '../artifact-store.js';
import { importDiscoveryArtifact } from '../import-discovery-artifact.js';
import type { WorkspaceSourceIngestQueue } from '../workspace-source-ingest-queue.js';
import type { WorkflowStore } from '../workflow-store.js';
import { WorkspaceSourceError, type WorkspaceSourceRecord } from './contracts.js';
import { summaryFrom } from './document.js';
import { errorCode, errorMessage } from './validation.js';

export interface WorkspaceSourceIngestionContext {
  store: WorkflowStore;
  artifactStore: ArtifactStore;
  ingestQueue: WorkspaceSourceIngestQueue;
  writeManifest: (source: WorkspaceSourceRecord) => void;
  notify: (source: WorkspaceSourceRecord) => void;
}

export interface WorkspaceSourceIngestJob {
  id: string;
  sessionId: string;
  artifactId: string;
  storedPath: string;
}

export function enqueuePdfIngestion(
  context: WorkspaceSourceIngestionContext,
  job: WorkspaceSourceIngestJob,
): void {
  context.ingestQueue.enqueue(job.id, () => ingestPdf(context, job));
}

async function ingestPdf(
  context: WorkspaceSourceIngestionContext,
  job: WorkspaceSourceIngestJob,
): Promise<void> {
  try {
    await importDiscoveryArtifact(context.artifactStore, job.storedPath);
    const document = context.artifactStore.getDocumentArtifact<DocumentArtifact>(job.artifactId);
    if (!document) throw new WorkspaceSourceError('document_ingest_missing_result');
    const ingested = context.artifactStore.getIngestResult<IngestDocumentResult>(job.artifactId);
    const source = context.store.updateWorkspaceSource(job.id, {
      status: 'ready',
      engine: ingested?.engine ?? document.engine,
      documentArtifactId: job.artifactId,
      summary: summaryFrom(ingested, document),
      errorCode: undefined,
      errorMessage: undefined,
      updatedAt: new Date().toISOString(),
    });
    if (!source) return;
    context.writeManifest(source);
    context.store.refreshWorkspaceChatTitle(job.sessionId);
    context.notify(source);
  } catch (error) {
    const code = errorCode(error);
    const source = context.store.updateWorkspaceSource(job.id, {
      status: 'failed',
      errorCode: code,
      errorMessage: errorMessage(code),
      updatedAt: new Date().toISOString(),
    });
    if (!source) return;
    context.writeManifest(source);
    context.store.refreshWorkspaceChatTitle(job.sessionId);
    context.notify(source);
  }
}

export async function resumePendingSources(context: WorkspaceSourceIngestionContext): Promise<void> {
  for (const chat of context.store.listWorkspaceChats()) {
    for (const source of context.store.listWorkspaceSources(chat.id)) {
      if (source.status !== 'processing') continue;
      const artifact = context.artifactStore.get(source.artifactId);
      if (!artifact || !existsSync(artifact.storedPath)) {
        const failed = context.store.updateWorkspaceSource(source.id, {
          status: 'failed',
          errorCode: 'workspace_source_artifact_missing',
          errorMessage: errorMessage('workspace_source_artifact_missing'),
          updatedAt: new Date().toISOString(),
        });
        if (failed) {
          context.writeManifest(failed);
          context.notify(failed);
        }
        continue;
      }
      enqueuePdfIngestion(context, {
        id: source.id,
        sessionId: source.sessionId,
        artifactId: source.artifactId,
        storedPath: artifact.storedPath,
      });
    }
  }
}
