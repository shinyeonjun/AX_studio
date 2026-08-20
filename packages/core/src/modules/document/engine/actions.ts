import type { ConnectorContext, ConnectorResult } from '../../types.js';
import type { FileRef } from '../../../contracts/artifacts/file-ref.js';
import { documentIngestPhysicalPath, resolveDocumentIngestExecution } from '../../../contracts/document-ingest-resolve.js';
import { toDocumentArtifact } from '../../../contracts/artifacts/document-normalize.js';
import { getDocumentEngineClient } from '../../../document-engine/engine-client.js';
import type { DocumentActionHandler } from '../types.js';

function resolveIngestPhysicalPath(
  params: Record<string, unknown>,
  ctx: ConnectorContext,
): { ok: true; path: string } | { ok: false; error: string; errorCode: string } {
  const existingPath = documentIngestPhysicalPath(params);
  if (existingPath) return { ok: true, path: existingPath };

  const resolved = resolveDocumentIngestExecution(params, ctx);
  if (!resolved.ok) {
    return { ok: false, error: resolved.error, errorCode: resolved.errorCode };
  }
  const path = documentIngestPhysicalPath(resolved.params);
  if (!path) {
    return { ok: false, error: '문서 입력이 비어 있습니다.', errorCode: 'document_input_required' };
  }
  return { ok: true, path };
}

export const ingest: DocumentActionHandler = async (params, ctx): Promise<ConnectorResult> => {
  const resolvedPath = resolveIngestPhysicalPath(params, ctx);
  if (!resolvedPath.ok) {
    return { ok: false, error: resolvedPath.error, errorCode: resolvedPath.errorCode };
  }

  try {
    const client = getDocumentEngineClient();
    const result = await client.ingest(resolvedPath.path, {
      ocr: (params.ocr as 'auto' | 'off' | 'force' | undefined) ?? 'auto',
      engine: (params.engine as 'auto' | 'basic' | 'docling' | undefined) ?? 'auto',
    });

    ctx.variables.documentId = result.documentId;
    ctx.variables.documentArtifactPath = result.artifactPath;
    ctx.variables.axDocumentSummary = result.summary;
    ctx.variables.documentEngine = result.engine;
    if (result.text?.trim()) ctx.variables.documentText = result.text;

    const sourceFile = (params.file as FileRef | undefined) ?? (ctx.variables.fileRef as FileRef | undefined);
    if (sourceFile?.name) ctx.variables.fileName = sourceFile.name;
    if (sourceFile) ctx.variables.fileRef = sourceFile;
    if (sourceFile?.folderId && !ctx.variables.folderLabel) {
      ctx.variables.folderLabel = sourceFile.folderId;
    }

    const artifact = toDocumentArtifact(result, sourceFile);

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

    return {
      ok: true,
      data: artifact,
    };
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
