import type { ConnectorContext, ConnectorResult } from '../../../types.js';
import { getDocumentEngineClient } from '../../../../document-engine/engine-client.js';
import type { DocumentActionHandler } from '../../types.js';

export const getChunk: DocumentActionHandler = async (params, ctx): Promise<ConnectorResult> => {
  const documentId = (params.documentId as string | undefined) ?? (ctx.variables.documentId as string | undefined);
  const chunkId = params.chunkId as string | undefined;
  if (!documentId?.trim()) return { ok: false, error: 'document_id_required', errorCode: 'document_id_required' };
  if (!chunkId?.trim()) return { ok: false, error: 'chunk_id_required', errorCode: 'chunk_id_required' };

  try {
    const data = await getDocumentEngineClient().getChunk(documentId.trim(), chunkId.trim());
    ctx.variables.documentChunk = data.chunk;
    return { ok: true, data };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message, errorCode: 'document_chunk_failed' };
  }
};
