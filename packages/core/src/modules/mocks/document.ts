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
      ctx.variables.documentHtml = html;
      if (action === 'pdf.generate') {
        ctx.variables.reportPdfBytes = Buffer.from('mock-pdf');
        ctx.variables.reportPdfSize = 8;
        ctx.variables.generatedPdfName = 'report.pdf';
        return {
          ok: true,
          data: {
            html,
            needsDesktopPrint: false,
            pdfBytes: Buffer.from('mock-pdf'),
            size: 8,
            mimeType: 'application/pdf',
            fileName: 'report.pdf',
          },
        };
      }
      return { ok: true, data: { html } };
    }
    return { ok: false, error: `Unknown document action: ${action}` };
  }
}
