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

/** Per-call lifecycle options for the shared engine client. Not worker input. */
export interface DocumentEngineCallOptions {
  abortSignal?: AbortSignal;
}

export interface DocumentEngineClient {
  ping(call?: DocumentEngineCallOptions): Promise<boolean>;
  ingest(path: string, options?: IngestDocumentOptions, call?: DocumentEngineCallOptions): Promise<IngestDocumentResult>;
  pdfToHtml(path: string, options?: PdfToHtmlOptions, call?: DocumentEngineCallOptions): Promise<PdfToHtmlResult>;
  pdfFormAnalyze(path: string, options?: PdfFormAnalyzeOptions, call?: DocumentEngineCallOptions): Promise<PdfFormTemplate>;
  pdfFormFill(path: string, options: PdfFormFillOptions, call?: DocumentEngineCallOptions): Promise<PdfFormFillResult>;
  pdfReportAnalyze(templatePath: string, examplePath: string, call?: DocumentEngineCallOptions): Promise<PdfReportPairAnalysis>;
  getChunk(documentId: string, chunkId: string, call?: DocumentEngineCallOptions): Promise<{ chunk: Record<string, unknown> }>;
  getPage(documentId: string, pageIndex: number, call?: DocumentEngineCallOptions): Promise<{ page: Record<string, unknown>; text: string | null }>;
  search(documentId: string, query: string, call?: DocumentEngineCallOptions): Promise<{ hits: DocumentChunkHit[] }>;
}
