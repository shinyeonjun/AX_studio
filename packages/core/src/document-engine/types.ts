export interface AxDocumentSummary {
  pageCount: number;
  chunkCount: number;
  tableCount: number;
  imageCount: number;
  visualPageCount: number;
  visualPages: number[];
  engine: string;
}

export interface AxDocumentBlock {
  id: string;
  pageIndex: number;
  kind: string;
  text: string;
}

export interface AxDocumentPage {
  index: number;
  hasVisual: boolean;
  ocrConfidence: number | null;
}

export interface AxDocumentMetadata {
  documentId: string;
  sourcePath: string;
  sourceHash: string;
  engine: string;
  ingestedAt: string;
}

/** AX-owned document contract. Docling types never cross this boundary. */
export interface AxDocument {
  id: string;
  artifactPath: string;
  metadata: AxDocumentMetadata;
  summary: AxDocumentSummary;
  pages: AxDocumentPage[];
  blocks: AxDocumentBlock[];
  tables: unknown[];
  images: unknown[];
}

export interface IngestDocumentOptions {
  ocr?: 'auto' | 'off' | 'force';
  engine?: 'auto' | 'basic' | 'docling';
}

export interface IngestDocumentResult {
  documentId: string;
  artifactPath: string;
  engine: string;
  summary: AxDocumentSummary;
}

export interface DocumentChunkHit {
  chunkId: string;
  pageIndex: number;
  snippet: string;
  score: number;
}

export interface DocumentEngineRequest {
  id: string;
  command: string;
  params?: Record<string, unknown>;
}

export interface DocumentEngineResponse<T = unknown> {
  id: string;
  ok: boolean;
  data?: T;
  error?: string;
}
