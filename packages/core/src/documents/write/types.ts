/** Supported output formats for the document write engine. */
export type DocumentWriteFormat = 'html' | 'docx' | 'pdf';

export interface HtmlRenderInput {
  template?: string;
  title?: string;
  data: Record<string, unknown>;
}

export interface HtmlRenderResult {
  html: string;
}

export interface PdfGenerateInput {
  html: string;
  title?: string;
}

/** Core produced HTML; desktop must run Chromium printToPDF. */
export interface PdfGeneratePending {
  html: string;
  needsDesktopPrint: true;
}

/** PDF bytes available (desktop bridge or mock). */
export interface PdfGenerateComplete {
  html: string;
  needsDesktopPrint: false;
  pdfBytes: Buffer;
  size: number;
  mimeType: 'application/pdf';
  fileName: string;
}

export type PdfGenerateResult = PdfGeneratePending | PdfGenerateComplete;

export function isPdfGeneratePending(result: PdfGenerateResult): result is PdfGeneratePending {
  return result.needsDesktopPrint === true;
}

export interface DocxFillInput {
  templatePath: string;
  data: Record<string, unknown>;
}

export interface DocxFillResult {
  buffer: Buffer;
  size: number;
}
