import type { PdfToHtmlOptions, PdfToHtmlResult } from '../../document-engine/types.js';
import { getDocumentEngineClient } from '../../document-engine/engine-client.js';

/** Import a PDF as an HTML template (Docling export_to_html with basic fallback). */
export async function importPdfTemplate(
  path: string,
  options: PdfToHtmlOptions = {},
): Promise<PdfToHtmlResult> {
  return getDocumentEngineClient().pdfToHtml(path, options);
}
