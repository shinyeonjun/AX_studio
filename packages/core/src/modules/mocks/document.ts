import type { Connector, ConnectorContext, ConnectorResult } from '../types.js';

export class MockDocumentConnector implements Connector {
  name = 'document';
  outputs: Array<{ format: string; content: string }> = [];

  async execute(action: string, params: Record<string, unknown>, ctx: ConnectorContext): Promise<ConnectorResult> {
    if (action === 'ingest') {
      const path = (params.path as string) ?? '';
      const documentId = `mock-${Buffer.from(path).toString('hex').slice(0, 12)}`;
      const summary = {
        pageCount: 1,
        chunkCount: 1,
        tableCount: 0,
        imageCount: 0,
        visualPageCount: 0,
        visualPages: [],
        engine: 'mock',
      };
      ctx.variables.documentId = documentId;
      ctx.variables.documentArtifactPath = `/mock/${documentId}`;
      ctx.variables.axDocumentSummary = summary;
      return { ok: true, data: { documentId, artifactPath: `/mock/${documentId}`, engine: 'mock', summary } };
    }
    if (action === 'getChunk') {
      return { ok: true, data: { chunk: { id: params.chunkId, pageIndex: 0, kind: 'paragraph', text: 'mock' } } };
    }
    if (action === 'getPage') {
      return { ok: true, data: { page: { index: params.pageIndex ?? 0, hasVisual: false }, text: 'mock page' } };
    }
    if (action === 'search') {
      return { ok: true, data: { hits: [{ chunkId: 'c0', pageIndex: 0, snippet: String(params.query ?? ''), score: 1 }] } };
    }
    if (action === 'pdf.toHtml') {
      const path = (params.path as string) ?? '';
      const templateId = `mock-${Buffer.from(path).toString('hex').slice(0, 12)}`;
      const html = `<html><body><h1>Mock Template</h1><p>${path}</p></body></html>`;
      ctx.variables.templateId = templateId;
      ctx.variables.templateHtml = html;
      ctx.variables.documentHtml = html;
      return {
        ok: true,
        data: {
          templateId,
          sourcePath: path,
          artifactPath: `/mock/templates/${templateId}`,
          htmlPath: `/mock/templates/${templateId}/template.html`,
          originalPdfPath: path,
          metaPath: `/mock/templates/${templateId}/meta.json`,
          engine: 'mock',
          pageCount: 1,
          html,
        },
      };
    }
    if (action === 'html.render' || action === 'pdf.generate' || action === 'docx.fill') {
      const html = `<html><body><h1>${params.title ?? 'Document'}</h1><pre>${JSON.stringify(params.data ?? ctx.variables, null, 2)}</pre></body></html>`;
      this.outputs.push({ format: action, content: html });
      if (action === 'pdf.generate') {
        if (!ctx.artifactSink) {
          return {
            ok: false,
            error: 'PDF 저장소가 준비되지 않았습니다.',
            errorCode: 'pdf_artifact_store_unavailable',
          };
        }
        const bytes = Buffer.from('mock-pdf');
        const stored = ctx.artifactSink.putBytes(bytes, {
          fileName: 'report.pdf',
          mimeType: 'application/pdf',
        });
        const artifact = {
          id: stored.id,
          sha256: stored.sha256,
          fileName: stored.fileName,
          ...(stored.mimeType ? { mimeType: stored.mimeType } : {}),
          size: stored.size,
          createdAt: stored.createdAt,
        };
        ctx.variables.reportPdfArtifact = artifact;
        ctx.variables.reportPdfArtifactId = artifact.id;
        ctx.variables.reportPdfSize = artifact.size;
        ctx.variables.generatedPdfName = artifact.fileName;
        return {
          ok: true,
          data: {
            needsDesktopPrint: false,
            size: artifact.size,
            mimeType: 'application/pdf',
            fileName: artifact.fileName,
            artifact,
          },
        };
      }
      ctx.variables.documentHtml = html;
      return { ok: true, data: { html } };
    }
    return { ok: false, error: `Unknown document action: ${action}` };
  }
}
