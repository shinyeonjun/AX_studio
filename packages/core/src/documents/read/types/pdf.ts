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
  /** Optional typography hints for geometry-derived overlay fields. */
  fontSize?: number;
  textColor?: [number, number, number];
  align?: 'left' | 'center' | 'right';
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
  writerEngine: 'pypdf-reportlab';
  verified: boolean;
  interactive: boolean;
  sourceUnchanged: boolean;
}

export interface PdfReportSlot {
  id: string;
  pageIndex: number;
  rect: PdfFormRect;
  exampleText: string;
  fontSize: number;
  font: string;
  color: number;
  /** Where a slot of a Word report sits ("본문 표1 3행 2열"); a PDF slot is placed by its box. */
  location?: string;
}

export interface PdfReportTableRow {
  index: number;
  pageIndex: number;
  y: number;
  cells: PdfReportSlot[];
}

export interface PdfReportTableGroup {
  id: string;
  columnCount: number;
  rowCount: number;
  rows: PdfReportTableRow[];
  /** Template-derived horizontal table bounds for each page continuation. */
  pageBounds?: Array<{ pageIndex: number; x: number; width: number }>;
}

/** One piece of text in a completed report, for deciding which pieces are this period's values. */
export interface PdfReportSpan {
  id: string;
  pageIndex: number;
  text: string;
  rect: { x: number; y: number; width: number; height: number };
  fontSize: number;
  /** Where a Word report's paragraph sits; its box is then only reading order, not a position. */
  location?: string;
}

/** Every text piece of a completed report that came without its blank form. */
export interface PdfReportSpans {
  schemaVersion: 1;
  exampleHash: string;
  pageCount: number;
  pages: PdfFormPage[];
  spans: PdfReportSpan[];
  /** Host-owned paths consumed only to attach actual vision bytes. */
  exampleImages: string[];
}

/** A value to take out of the completed report: `text` inside the span's box. */
export interface PdfReportValueRemoval {
  /** The span the text is in; a Word report finds its paragraph by this, a PDF by the box. */
  spanId?: string;
  pageIndex: number;
  rect: PdfReportSpan['rect'];
  text: string;
}

/** Geometry-first comparison of a completed report and its blank template. */
export interface PdfReportPairAnalysis {
  schemaVersion: 1;
  pairId: string;
  templateHash: string;
  exampleHash: string;
  pageCount: number;
  pages: PdfFormPage[];
  scalarSlots: PdfReportSlot[];
  tableGroups: PdfReportTableGroup[];
  /**
   * `flow`: a Word report. Its boxes are only reading order, and a table grows by copying its
   * last row in the document's own flow, so page room is not a limit.
   */
  layout?: 'flow';
  /** Host-owned paths consumed only to attach actual vision bytes. */
  templateImages: string[];
  /** Host-owned paths consumed only to attach actual vision bytes. */
  exampleImages: string[];
}

/** Last period's Word report with its values marked, and its slots described like a PDF pair. */
export interface DocxReportPrepared {
  templatePath: string;
  pair: PdfReportPairAnalysis;
}

/** One repeating table of a Word report: slot ids per row, in column order. */
export interface DocxReportFillGroup {
  id: string;
  rows: string[][];
}

export interface DocxReportFillResult {
  outputPath: string;
  outputHash: string;
  verified: boolean;
  fieldCount: number;
}
