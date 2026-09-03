import type { DocumentArtifact } from '../../contracts/artifacts/document.js';
import type { IngestDocumentResult } from '../../document-engine/types.js';
import type { WorkspaceSourceDocument, WorkspaceSourceRecord, WorkspaceSourceSummary } from './contracts.js';

export function summaryFrom(
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

export function publicDocument(document: DocumentArtifact): WorkspaceSourceDocument {
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

export function boundedDocument(document: DocumentArtifact, maxChars: number): WorkspaceSourceDocument {
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

export function manifestSource(source: WorkspaceSourceRecord): WorkspaceSourceRecord {
  return source;
}
