import type { PdfToHtmlOptions, PdfToHtmlResult } from '../../read/types.js';
import { getDocumentEngineClient } from '../../read/engine-client.js';

/** Import a PDF as an HTML template (Docling export_to_html with basic fallback). */
export async function importPdfTemplate(
  path: string,
  options: PdfToHtmlOptions = {},
): Promise<PdfToHtmlResult> {
  return getDocumentEngineClient().pdfToHtml(path, options);
}
