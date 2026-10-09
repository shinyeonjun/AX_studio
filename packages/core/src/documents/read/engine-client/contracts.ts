import type {
  DocumentChunkHit,
  DocxReportFillGroup,
  DocxReportFillResult,
  DocxReportPrepared,
  IngestDocumentOptions,
  IngestDocumentResult,
  PdfFormAnalyzeOptions,
  PdfFormFillOptions,
  PdfFormFillResult,
  PdfFormTemplate,
  PdfReportPairAnalysis,
  PdfReportSpans,
  PdfReportValueRemoval,
  PdfToHtmlOptions,
  PdfToHtmlResult,
} from '../types.js';

export interface DocumentEngineClientOptions {
  pythonPath?: string;
  workerScript?: string;
  artifactRoot?: string;
  timeoutMs?: number;
  workerCwd?: string;
  /** See DocumentEnginePathOptions; defaults to the host policy / packaged detection. */
  allowEnvOverrides?: boolean;
}

/** Host-side control of one engine call; never sent to the worker. */
export interface DocumentEngineCallControl {
  /** Stops the worker process (and its children) when the caller gives up, e.g. a cancelled run. */
  abortSignal?: AbortSignal;
}

export interface DocumentEngineClient {
  ping(): Promise<boolean>;
  ingest(path: string, options?: IngestDocumentOptions, control?: DocumentEngineCallControl): Promise<IngestDocumentResult>;
  pdfToHtml(path: string, options?: PdfToHtmlOptions): Promise<PdfToHtmlResult>;
  pdfFormAnalyze(path: string, options?: PdfFormAnalyzeOptions): Promise<PdfFormTemplate>;
  pdfFormFill(path: string, options: PdfFormFillOptions): Promise<PdfFormFillResult>;
  pdfReportAnalyze(templatePath: string, examplePath: string): Promise<PdfReportPairAnalysis>;
  /** The text pieces of a completed report, so its values can be told from the form. */
  pdfReportSpans(examplePath: string): Promise<PdfReportSpans>;
  /** The completed report with these values taken out: the blank form it was written on. */
  pdfReportBlank(examplePath: string, removals: PdfReportValueRemoval[], outputPath: string): Promise<{ templatePath: string }>;
  /** Each paragraph of last period's Word report, with where it sits. */
  docxReportSpans(examplePath: string): Promise<PdfReportSpans>;
  /** The Word report with these values marked as slots, and the slots described as a pair. */
  docxReportPrepare(examplePath: string, removals: PdfReportValueRemoval[], templatePath: string): Promise<DocxReportPrepared>;
  /** This period's Word report: repeating rows grown or cut to fit, every slot replaced. */
  docxReportFill(templatePath: string, options: { groups: DocxReportFillGroup[]; values: Record<string, string>; outputPath: string }): Promise<DocxReportFillResult>;
  getChunk(documentId: string, chunkId: string): Promise<{ chunk: Record<string, unknown> }>;
  getPage(documentId: string, pageIndex: number): Promise<{ page: Record<string, unknown>; text: string | null }>;
  search(documentId: string, query: string): Promise<{ hits: DocumentChunkHit[] }>;
}
