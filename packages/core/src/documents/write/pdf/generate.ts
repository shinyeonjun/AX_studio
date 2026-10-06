import { getDesktopPrintBridge } from '../desktop-print.js';
import type { PdfGenerateInput, PdfGenerateResult } from '../types.js';

const MAX_PDF_BASE_NAME_CHARS = 120;

/** Exported for tests. NFC first: macOS/NFD titles would otherwise turn every Hangul jamo into `_`. */
export function pdfFileName(title?: string): string {
  const base = (title?.normalize('NFC').trim() || 'report')
    .replace(/[^\w\uAC00-\uD7A3.-]+/g, '_')
    .replace(/\.pdf$/i, '')
    .slice(0, MAX_PDF_BASE_NAME_CHARS)
    .replace(/[._]+$/, '');
  return `${base || 'report'}.pdf`;
}

export async function generatePdf(input: PdfGenerateInput): Promise<PdfGenerateResult> {
  const bridge = getDesktopPrintBridge();
  if (!bridge) {
    return { html: input.html, needsDesktopPrint: true };
  }

  const pdfBytes = await bridge.printHtml(input.html, { title: input.title });
  const fileName = pdfFileName(input.title);
  return {
    html: input.html,
    needsDesktopPrint: false,
    pdfBytes,
    size: pdfBytes.length,
    mimeType: 'application/pdf',
    fileName,
  };
}
