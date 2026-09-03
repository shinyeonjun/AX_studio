import { getDocumentEngineClient } from '../../../../document-engine/engine-client.js';
import type { PdfFormAnalyzeOptions } from '../../../../document-engine/types.js';
import type { ConnectorContext, ConnectorResult } from '../../../types.js';
import type { DocumentActionHandler } from '../../types.js';
import { resolvePdfPath } from './to-html.js';

export const pdfFormAnalyze: DocumentActionHandler = async (params, ctx): Promise<ConnectorResult> => {
  const resolvedPath = resolvePdfPath(params, ctx);
  if (!resolvedPath.ok) {
    return { ok: false, error: resolvedPath.error, errorCode: resolvedPath.errorCode };
  }

  try {
    const options: PdfFormAnalyzeOptions = {
      ocr: (params.ocr as PdfFormAnalyzeOptions['ocr'] | undefined) ?? 'auto',
      ...(Array.isArray(params.fieldHints) ? { fieldHints: params.fieldHints as PdfFormAnalyzeOptions['fieldHints'] } : {}),
    };
    const template = await getDocumentEngineClient().pdfFormAnalyze(resolvedPath.path, options);
    ctx.variables.pdfFormTemplate = template;
    ctx.variables.pdfFormTemplatePath = template.templatePath;
    ctx.variables.pdfFormSourcePath = resolvedPath.path;
    ctx.log({
      at: new Date().toISOString(),
      level: 'info',
      message: 'document.pdf.form.analyze',
      data: {
        templateId: template.templateId,
        engine: template.engine,
        pageCount: template.pageCount,
        fieldCount: template.fields.length,
        requiresReview: template.requiresReview,
      },
    });
    return { ok: true, data: template };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message, errorCode: 'pdf_form_analyze_failed' };
  }
};
