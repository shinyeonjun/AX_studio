import type { ConnectorContext, ConnectorResult } from '../../../types.js';
import { getDocumentEngineClient } from '../../../../document-engine/engine-client.js';
import type { DocumentActionHandler } from '../../types.js';

export const search: DocumentActionHandler = async (params, ctx): Promise<ConnectorResult> => {
  const documentId = (params.documentId as string | undefined) ?? (ctx.variables.documentId as string | undefined);
  const query = (params.query as string | undefined) ?? '';
  if (!documentId?.trim()) return { ok: false, error: 'document_id_required', errorCode: 'document_id_required' };
  if (!query.trim()) return { ok: false, error: 'query_required', errorCode: 'query_required' };

  try {
    const data = await getDocumentEngineClient().search(documentId.trim(), query.trim());
    ctx.variables.documentSearchHits = data.hits;
    return { ok: true, data };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message, errorCode: 'document_search_failed' };
  }
};
