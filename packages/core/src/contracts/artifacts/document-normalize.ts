import type { IngestDocumentResult } from '../../document-engine/types.js';
import type { FileRef } from './file-ref.js';
import type { DocumentArtifact } from './document.js';

export function toDocumentArtifact(
  result: IngestDocumentResult,
  source?: FileRef,
): DocumentArtifact {
  return {
    id: result.documentId,
    source,
    artifactPath: result.artifactPath,
    engine: result.engine,
    pageCount: result.summary.pageCount,
    chunkCount: result.summary.chunkCount,
    tableCount: result.summary.tableCount,
    imageCount: result.summary.imageCount,
    text: result.text,
    pages: result.summary.visualPages.map((index) => ({
      index,
      hasVisual: true,
    })),
  };
}
