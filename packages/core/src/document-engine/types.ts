export interface AxDocumentSummary {
  pageCount: number;
  chunkCount: number;
  tableCount: number;
  imageCount: number;
  visualPageCount: number;
  visualPages: number[];
  ocrPageCount?: number;
  ocrPages?: number[];
  engine: string;
}

export interface AxDocumentPageDetail {
  index: number;
  text?: string | null;
  hasVisual?: boolean;
  sourceType?: 'native' | 'image' | 'scan' | 'mixed';
  ocrApplied?: boolean;
  imagePath?: string | null;
  ocrConfidence?: number | null;
}

export interface AxDocumentImageRef {
  id: string;
  pageIndex: number;
  path?: string;
  ocrText?: string;
  ocrConfidence?: number | null;
}

export interface AxDocumentTableRef {
  id: string;
  pageIndex: number;
  text?: string;
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
  text?: string;
  pages?: AxDocumentPageDetail[];
  images?: AxDocumentImageRef[];
  tables?: AxDocumentTableRef[];
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

export interface PdfToHtmlOptions {
  ocr?: 'auto' | 'off' | 'force';
  engine?: 'auto' | 'basic' | 'docling';
}

export interface PdfToHtmlResult {
  templateId: string;
  sourcePath: string;
  artifactPath: string;
  htmlPath: string;
  originalPdfPath: string;
  metaPath: string;
  engine: string;
  pageCount: number;
  html: string;
  cached?: boolean;
}
