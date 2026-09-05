import type {
  DocumentChunkHit,
  IngestDocumentOptions,
  IngestDocumentResult,
  PdfFormAnalyzeOptions,
  PdfFormFillOptions,
  PdfFormFillResult,
  PdfFormTemplate,
  PdfReportPairAnalysis,
  PdfToHtmlOptions,
  PdfToHtmlResult,
} from '../types.js';

export interface DocumentEngineClientOptions {
  pythonPath?: string;
  workerScript?: string;
  artifactRoot?: string;
  timeoutMs?: number;
  workerCwd?: string;
}

export interface DocumentEngineClient {
  ping(): Promise<boolean>;
  ingest(path: string, options?: IngestDocumentOptions): Promise<IngestDocumentResult>;
  pdfToHtml(path: string, options?: PdfToHtmlOptions): Promise<PdfToHtmlResult>;
  pdfFormAnalyze(path: string, options?: PdfFormAnalyzeOptions): Promise<PdfFormTemplate>;
  pdfFormFill(path: string, options: PdfFormFillOptions): Promise<PdfFormFillResult>;
  pdfReportAnalyze(templatePath: string, examplePath: string): Promise<PdfReportPairAnalysis>;
  getChunk(documentId: string, chunkId: string): Promise<{ chunk: Record<string, unknown> }>;
  getPage(documentId: string, pageIndex: number): Promise<{ page: Record<string, unknown>; text: string | null }>;
  search(documentId: string, query: string): Promise<{ hits: DocumentChunkHit[] }>;
}
