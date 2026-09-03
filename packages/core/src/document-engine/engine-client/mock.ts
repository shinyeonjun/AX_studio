import type {
  DocumentChunkHit,
  IngestDocumentOptions,
  IngestDocumentResult,
  PdfFormAnalyzeOptions,
  PdfFormFillOptions,
  PdfFormFillResult,
  PdfFormTemplate,
  PdfToHtmlOptions,
  PdfToHtmlResult,
} from '../types.js';
import type { DocumentEngineClient } from './contracts.js';

export class MockDocumentEngineClient implements DocumentEngineClient {
  documents = new Map<string, IngestDocumentResult>();

  async ping(): Promise<boolean> {
    return true;
  }

  async ingest(path: string, options: IngestDocumentOptions = {}): Promise<IngestDocumentResult> {
    const documentId = 'mock-' + Buffer.from(path).toString('hex').slice(0, 16);
    const summary = {
      pageCount: 1,
      chunkCount: 1,
      tableCount: 0,
      imageCount: 0,
      visualPageCount: 0,
      visualPages: [],
      engine: options.engine ?? 'mock',
    };
    const result: IngestDocumentResult = {
      documentId,
      artifactPath: '/mock/documents/' + documentId,
      engine: summary.engine,
      summary,
    };
    this.documents.set(documentId, result);
    return result;
  }

  async pdfToHtml(path: string, options: PdfToHtmlOptions = {}): Promise<PdfToHtmlResult> {
    const templateId = 'mock-' + Buffer.from(path).toString('hex').slice(0, 16);
    const html = '<html><body><h1>Mock template</h1><p>' + path + '</p></body></html>';
    return {
      templateId,
      sourcePath: path,
      artifactPath: '/mock/templates/' + templateId,
      htmlPath: '/mock/templates/' + templateId + '/template.html',
      originalPdfPath: path,
      metaPath: '/mock/templates/' + templateId + '/meta.json',
      engine: options.engine ?? 'mock',
      pageCount: 1,
      html,
    };
  }

  async pdfFormAnalyze(path: string, _options: PdfFormAnalyzeOptions = {}): Promise<PdfFormTemplate> {
    return {
      schemaVersion: 1,
      templateId: 'mock-' + Buffer.from(path).toString('hex').slice(0, 16),
      sourceName: path.split(/[\\/]/).pop() ?? path,
      sourceHash: 'mock-source-hash',
      pageCount: 1,
      coordinateSpace: 'pdf-user-top-left-unrotated',
      engine: 'layout_hint',
      mode: 'overlay',
      requiresReview: false,
      warnings: [],
      pages: [{ index: 0, width: 595, height: 842, rotation: 0 }],
      fields: [],
      createdAt: new Date().toISOString(),
    };
  }

  async pdfFormFill(path: string, options: PdfFormFillOptions): Promise<PdfFormFillResult> {
    return {
      sourcePath: path,
      outputPath: options.outputPath ?? '/mock/filled.pdf',
      sourceHash: 'mock-source-hash',
      outputHash: 'mock-output-hash',
      pageCount: 1,
      fieldCount: Object.keys(options.values).length,
      writerEngine: 'pymupdf',
      verified: true,
      interactive: false,
      sourceUnchanged: true,
    };
  }

  async getChunk(documentId: string, chunkId: string): Promise<{ chunk: Record<string, unknown> }> {
    if (!this.documents.has(documentId)) throw new Error('document_not_found');
    return { chunk: { id: chunkId, pageIndex: 0, kind: 'paragraph', text: 'mock chunk' } };
  }

  async getPage(
    documentId: string,
    pageIndex: number,
  ): Promise<{ page: Record<string, unknown>; text: string | null }> {
    if (!this.documents.has(documentId)) throw new Error('document_not_found');
    return {
      page: { index: pageIndex, hasVisual: false, ocrConfidence: null },
      text: 'mock page text',
    };
  }

  async search(documentId: string, query: string): Promise<{ hits: DocumentChunkHit[] }> {
    if (!this.documents.has(documentId)) throw new Error('document_not_found');
    return {
      hits: query
        ? [{ chunkId: 'c0', pageIndex: 0, snippet: 'mock:' + query, score: 1 }]
        : [],
    };
  }
}
