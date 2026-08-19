import type { ConnectorContext, ConnectorResult } from '../../types.js';
import { getDocumentEngineClient } from '../../../document-engine/engine-client.js';
import type { DocumentActionHandler } from '../types.js';

export const ingest: DocumentActionHandler = async (params, ctx): Promise<ConnectorResult> => {
  const path = params.path as string | undefined;
  if (!path) return { ok: false, error: '문서 경로가 비어 있습니다.', errorCode: 'path_required' };

  try {
    const client = getDocumentEngineClient();
    const result = await client.ingest(path, {
      ocr: (params.ocr as 'auto' | 'off' | 'force' | undefined) ?? 'auto',
      engine: (params.engine as 'auto' | 'basic' | 'docling' | undefined) ?? 'auto',
    });

    ctx.variables.documentId = result.documentId;
    ctx.variables.documentArtifactPath = result.artifactPath;
    ctx.variables.axDocumentSummary = result.summary;

    ctx.log({
      at: new Date().toISOString(),
      level: 'info',
      message: 'document.ingest',
      data: {
        documentId: result.documentId,
        engine: result.engine,
        pageCount: result.summary.pageCount,
      },
    });

    return { ok: true, data: result };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message, errorCode: 'document_ingest_failed' };
  }
};

export const getChunk: DocumentActionHandler = async (params, ctx): Promise<ConnectorResult> => {
  const documentId = (params.documentId as string | undefined) ?? (ctx.variables.documentId as string | undefined);
  const chunkId = params.chunkId as string | undefined;
  if (!documentId) return { ok: false, error: 'document_id_required' };
  if (!chunkId) return { ok: false, error: 'chunk_id_required' };

  try {
    const data = await getDocumentEngineClient().getChunk(documentId, chunkId);
    ctx.variables.documentChunk = data.chunk;
    return { ok: true, data };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message };
  }
};

export const getPage: DocumentActionHandler = async (params, ctx): Promise<ConnectorResult> => {
  const documentId = (params.documentId as string | undefined) ?? (ctx.variables.documentId as string | undefined);
  const pageIndex = params.pageIndex;
  if (!documentId) return { ok: false, error: 'document_id_required' };
  if (pageIndex === undefined || pageIndex === null) return { ok: false, error: 'page_index_required' };

  try {
    const data = await getDocumentEngineClient().getPage(documentId, Number(pageIndex));
    ctx.variables.documentPage = data.page;
    ctx.variables.documentPageText = data.text;
    return { ok: true, data };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message };
  }
};

export const search: DocumentActionHandler = async (params, ctx): Promise<ConnectorResult> => {
  const documentId = (params.documentId as string | undefined) ?? (ctx.variables.documentId as string | undefined);
  const query = (params.query as string | undefined) ?? '';
  if (!documentId) return { ok: false, error: 'document_id_required' };

  try {
    const data = await getDocumentEngineClient().search(documentId, query);
    ctx.variables.documentSearchHits = data.hits;
    return { ok: true, data };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message };
  }
};
