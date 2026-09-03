import { importPdfTemplate } from '../../../../document-write/pdf/to-html.js';
import { documentIngestPhysicalPath, resolveDocumentIngestExecution } from '../../../../contracts/document-ingest-resolve.js';
import type { ConnectorContext, ConnectorResult } from '../../../types.js';
import type { DocumentActionHandler } from '../../types.js';

export function resolvePdfPath(
  params: Record<string, unknown>,
  ctx: ConnectorContext,
): { ok: true; path: string } | { ok: false; error: string; errorCode: string } {
  const resolved = resolveDocumentIngestExecution(params, ctx);
  if (!resolved.ok) {
    return { ok: false, error: resolved.error, errorCode: resolved.errorCode };
  }
  const path = documentIngestPhysicalPath(resolved.params);
  if (!path) {
    return { ok: false, error: 'PDF 경로가 필요합니다.', errorCode: 'pdf_path_required' };
  }
  return { ok: true, path };
}

export const pdfToHtml: DocumentActionHandler = async (params, ctx): Promise<ConnectorResult> => {
  const resolvedPath = resolvePdfPath(params, ctx);
  if (!resolvedPath.ok) {
    return { ok: false, error: resolvedPath.error, errorCode: resolvedPath.errorCode };
  }

  try {
    const result = await importPdfTemplate(resolvedPath.path, {
      engine: (params.engine as 'auto' | 'basic' | 'docling' | undefined) ?? 'auto',
      ocr: (params.ocr as 'auto' | 'off' | 'force' | undefined) ?? 'auto',
    });

    ctx.variables.templateId = result.templateId;
    ctx.variables.templateHtml = result.html;
    ctx.variables.templateHtmlPath = result.htmlPath;
    ctx.variables.templateArtifactPath = result.artifactPath;
    ctx.variables.documentHtml = result.html;

    ctx.log({
      at: new Date().toISOString(),
      level: 'info',
      message: 'document.pdf.toHtml',
      data: {
        templateId: result.templateId,
        engine: result.engine,
        pageCount: result.pageCount,
        cached: result.cached ?? false,
      },
    });

    return { ok: true, data: result };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message, errorCode: 'pdf_to_html_failed' };
  }
};
