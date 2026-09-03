import { existsSync, readFileSync } from 'node:fs';
import { getDocumentEngineClient } from '../../../../document-engine/engine-client.js';
import type { PdfFormFillOptions } from '../../../../document-engine/types.js';
import type { ArtifactReference, ConnectorContext, ConnectorResult } from '../../../types.js';
import type { DocumentActionHandler } from '../../types.js';
import { resolvePdfPath } from './to-html.js';

function valuesFromParams(params: Record<string, unknown>, ctx: ConnectorContext): Record<string, unknown> | null {
  const candidate = params.values ?? ctx.variables.pdfFormValues;
  return candidate && typeof candidate === 'object' && !Array.isArray(candidate)
    ? (candidate as Record<string, unknown>)
    : null;
}

export const pdfFormFill: DocumentActionHandler = async (params, ctx): Promise<ConnectorResult> => {
  const resolvedPath = resolvePdfPath(params, ctx);
  if (!resolvedPath.ok) {
    return { ok: false, error: resolvedPath.error, errorCode: resolvedPath.errorCode };
  }
  const values = valuesFromParams(params, ctx);
  if (!values) return { ok: false, error: 'PDF 양식 값이 필요합니다.', errorCode: 'pdf_form_values_required' };
  const template = params.template ?? params.templatePath ?? ctx.variables.pdfFormTemplate ?? ctx.variables.pdfFormTemplatePath;
  if (!template) return { ok: false, error: 'PDF 양식 템플릿이 필요합니다.', errorCode: 'pdf_form_template_required' };

  try {
    const options: PdfFormFillOptions = {
      values,
      ...(typeof template === 'string' ? { templatePath: template } : {}),
      ...(template && typeof template === 'object' ? { template: template as PdfFormFillOptions['template'] } : {}),
      ...(typeof params.outputPath === 'string' ? { outputPath: params.outputPath } : {}),
      ...(typeof params.fontPath === 'string' ? { fontPath: params.fontPath } : {}),
    };
    const result = await getDocumentEngineClient().pdfFormFill(resolvedPath.path, options);
    ctx.variables.pdfFormFillResult = result;
    ctx.variables.pdfFormOutputPath = result.outputPath;

    let artifact: ArtifactReference | undefined;
    if (ctx.artifactSink && existsSync(result.outputPath)) {
      artifact = ctx.artifactSink.putBytes(readFileSync(result.outputPath), {
        fileName: result.outputPath.split(/[\\/]/).pop() || 'filled-form.pdf',
        mimeType: 'application/pdf',
      });
      ctx.variables.pdfFormArtifact = artifact;
    }
    ctx.log({
      at: new Date().toISOString(),
      level: 'info',
      message: 'document.pdf.form.fill',
      data: {
        outputHash: result.outputHash,
        pageCount: result.pageCount,
        fieldCount: result.fieldCount,
        writerEngine: result.writerEngine,
        verified: result.verified,
        interactive: result.interactive,
        artifactId: artifact?.id,
      },
    });
    return { ok: true, data: artifact ? { ...result, artifact } : result };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message, errorCode: 'pdf_form_fill_failed' };
  }
};
