import { generatePdf } from '../../../../document-write/pdf/generate.js';
import { isPdfGeneratePending } from '../../../../document-write/types.js';
import type { ArtifactReference, ConnectorContext, ConnectorResult } from '../../../types.js';
import type { DocumentActionHandler } from '../../types.js';

export const pdfGenerate: DocumentActionHandler = async (
  params: Record<string, unknown>,
  ctx: ConnectorContext,
): Promise<ConnectorResult> => {
  const html = (params.html as string) ?? (ctx.variables.documentHtml as string);
  if (typeof html !== 'string' || !html.trim()) {
    return { ok: false, error: 'html required', errorCode: 'html_required' };
  }
  if (!ctx.artifactSink) {
    return {
      ok: false,
      error: 'PDF 저장소가 준비되지 않았습니다.',
      errorCode: 'pdf_artifact_store_unavailable',
    };
  }
  const title = (params.title as string | undefined) ?? (ctx.variables.documentTitle as string | undefined);

  try {
    const result = await generatePdf({ html, title });

    if (isPdfGeneratePending(result)) {
      return {
        ok: false,
        error: '데스크톱 PDF 인쇄 브리지가 준비되지 않았습니다.',
        errorCode: 'desktop_print_unavailable',
      };
    }

    let stored;
    try {
      stored = ctx.artifactSink.putBytes(result.pdfBytes, {
        fileName: result.fileName,
        mimeType: result.mimeType,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        error: `PDF 저장에 실패했습니다: ${message}`,
        errorCode: 'pdf_artifact_store_failed',
      };
    }
    const artifact: ArtifactReference = {
      id: stored.id,
      sha256: stored.sha256,
      fileName: stored.fileName,
      ...(stored.mimeType ? { mimeType: stored.mimeType } : {}),
      size: stored.size,
      createdAt: stored.createdAt,
    };
    delete ctx.variables.documentHtml;
    delete ctx.variables.reportPdfBytes;
    ctx.variables.reportPdfArtifact = artifact;
    ctx.variables.reportPdfArtifactId = artifact.id;
    ctx.variables.reportPdfSize = artifact.size;
    ctx.variables.generatedPdfName = artifact.fileName;
    ctx.log({
      at: new Date().toISOString(),
      level: 'info',
      code: 'pdf_generated',
      message: 'PDF 보고서를 생성하고 저장했습니다.',
      data: {
        artifactId: artifact.id,
        fileName: artifact.fileName,
        size: artifact.size,
        mimeType: artifact.mimeType,
      },
    });
    return {
      ok: true,
      data: {
        needsDesktopPrint: false,
        size: result.size,
        mimeType: result.mimeType,
        fileName: result.fileName,
        artifact,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message, errorCode: 'pdf_generate_failed' };
  }
};
