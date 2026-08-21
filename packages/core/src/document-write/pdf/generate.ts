import { getDesktopPrintBridge } from '../desktop-print.js';
import { isPdfGeneratePending, type PdfGenerateInput, type PdfGenerateResult } from '../types.js';

export { isPdfGeneratePending };

function pdfFileName(title?: string): string {
  const base = (title?.trim() || 'report').replace(/[^\w\uAC00-\uD7A3.-]+/g, '_');
  return base.endsWith('.pdf') ? base : `${base}.pdf`;
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
