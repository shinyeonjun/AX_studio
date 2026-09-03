import type { ConnectorContext, ConnectorResult } from '../../../types.js';
import { getDocumentEngineClient } from '../../../../document-engine/engine-client.js';
import type { DocumentActionHandler } from '../../types.js';

export const getPage: DocumentActionHandler = async (params, ctx): Promise<ConnectorResult> => {
  const documentId = (params.documentId as string | undefined) ?? (ctx.variables.documentId as string | undefined);
  const pageIndex = params.pageIndex;
  if (!documentId?.trim()) return { ok: false, error: 'document_id_required', errorCode: 'document_id_required' };
  if (pageIndex === undefined || pageIndex === null) {
    return { ok: false, error: 'page_index_required', errorCode: 'page_index_required' };
  }
  if (
    (typeof pageIndex !== 'number' && typeof pageIndex !== 'string') ||
    (typeof pageIndex === 'string' && !pageIndex.trim())
  ) {
    return { ok: false, error: 'page_index_invalid', errorCode: 'page_index_invalid' };
  }
  const numericPageIndex = Number(pageIndex);
  if (!Number.isInteger(numericPageIndex) || numericPageIndex < 0) {
    return { ok: false, error: 'page_index_invalid', errorCode: 'page_index_invalid' };
  }

  try {
    const data = await getDocumentEngineClient().getPage(documentId.trim(), numericPageIndex);
    ctx.variables.documentPage = data.page;
    ctx.variables.documentPageText = data.text;
    return { ok: true, data };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message, errorCode: 'document_page_failed' };
  }
};
