import type { IngestDocumentResult } from '../../document-engine/types.js';
import type { FileRef } from './file-ref.js';
import type { DocumentArtifact } from './document.js';

function pageDetails(result: IngestDocumentResult) {
  if (result.pages?.length) {
    return result.pages.map((page) => ({
      index: page.index,
      text: page.text ?? undefined,
      hasVisual: page.hasVisual ?? false,
      sourceType: page.sourceType,
      ocrApplied: page.ocrApplied,
      imagePath: page.imagePath ?? undefined,
      ocrConfidence: page.ocrConfidence ?? undefined,
    }));
  }
  return result.summary.visualPages.map((index) => ({
    index,
    hasVisual: true,
  }));
}

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
    pages: pageDetails(result),
    images: (result.images ?? []).map((image) => ({
      id: image.id,
      pageIndex: image.pageIndex,
      path: image.path,
      ocrText: image.ocrText,
      ocrConfidence: image.ocrConfidence ?? undefined,
    })),
    tables: (result.tables ?? []).map((table) => ({
      id: table.id,
      pageIndex: table.pageIndex,
      text: table.text,
    })),
  };
}
