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

export type PdfFormFieldType =
  | 'text'
  | 'textarea'
  | 'date'
  | 'number'
  | 'checkbox'
  | 'radio'
  | 'select'
  | 'button'
  | 'signature'
  | 'unknown';

export interface PdfFormRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PdfFormPage {
  index: number;
  width: number;
  height: number;
  rotation: number;
}

export interface PdfFormField {
  id: string;
  name: string;
  label: string;
  pageIndex: number;
  rect: PdfFormRect;
  type: PdfFormFieldType;
  source: 'acroform' | 'digital_placeholder' | 'digital_geometry' | 'ocr_placeholder' | 'ocr_label' | 'ocr_geometry' | 'layout_hint';
  confidence: number;
  required: boolean;
  multiline: boolean;
  originalValue?: string;
  exportValue?: string;
  options?: string[];
}

export interface PdfFormTemplate {
  schemaVersion: number;
  templateId: string;
  sourceName: string;
  sourceHash: string;
  pageCount: number;
  coordinateSpace: 'pdf-user-top-left-unrotated';
  engine: 'acroform' | 'digital' | 'ocr' | 'layout_hint' | 'none';
  mode: 'acroform' | 'digital' | 'ocr' | 'overlay';
  requiresReview: boolean;
  warnings: string[];
  pages: PdfFormPage[];
  fields: PdfFormField[];
  createdAt: string;
  artifactPath?: string;
  originalPdfPath?: string;
  templatePath?: string;
}

export interface PdfFormAnalyzeOptions {
  ocr?: 'auto' | 'off' | 'force';
  fieldHints?: Array<{
    id?: string;
    name?: string;
    label?: string;
    pageIndex: number;
    rect: PdfFormRect | [number, number, number, number];
    type?: PdfFormFieldType;
    confidence?: number;
    required?: boolean;
    multiline?: boolean;
  }>;
}

export interface PdfFormFillOptions {
  templatePath?: string;
  template?: PdfFormTemplate;
  values: Record<string, unknown>;
  outputPath?: string;
  fontPath?: string;
}

export interface PdfFormFillResult {
  sourcePath: string;
  outputPath: string;
  sourceHash: string;
  outputHash: string;
  pageCount: number;
  fieldCount: number;
  writerEngine: 'pymupdf';
  verified: boolean;
  interactive: boolean;
  sourceUnchanged: boolean;
}
