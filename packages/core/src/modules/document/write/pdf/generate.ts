import { generatePdf } from '../../../../document-write/pdf/generate.js';
import { isPdfGeneratePending } from '../../../../document-write/types.js';
import type { ConnectorContext, ConnectorResult } from '../../../types.js';
import type { DocumentActionHandler } from '../../types.js';

export const pdfGenerate: DocumentActionHandler = async (
  params: Record<string, unknown>,
  ctx: ConnectorContext,
): Promise<ConnectorResult> => {
  const html = (params.html as string) ?? (ctx.variables.documentHtml as string);
  if (typeof html !== 'string' || !html.trim()) {
    return { ok: false, error: 'html required', errorCode: 'html_required' };
  }
  const title = (params.title as string | undefined) ?? (ctx.variables.documentTitle as string | undefined);

  try {
    const result = await generatePdf({ html, title });
    ctx.variables.documentHtml = result.html;

    if (isPdfGeneratePending(result)) {
      return { ok: true, data: result };
    }

    ctx.variables.reportPdfBytes = result.pdfBytes;
    ctx.variables.reportPdfSize = result.size;
    ctx.variables.generatedPdfName = result.fileName;
    return { ok: true, data: result };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message, errorCode: 'pdf_generate_failed' };
  }
};
