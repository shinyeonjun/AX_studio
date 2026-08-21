import { fillDocx } from '../../../../document-write/docx/fill.js';
import { documentIngestPhysicalPath, resolveDocumentIngestExecution } from '../../../../contracts/document-ingest-resolve.js';
import type { ConnectorContext, ConnectorResult } from '../../../types.js';
import type { DocumentActionHandler } from '../../types.js';

export const docxFill: DocumentActionHandler = async (
  params: Record<string, unknown>,
  ctx: ConnectorContext,
): Promise<ConnectorResult> => {
  const data = (params.data as Record<string, unknown>) ?? ctx.variables;
  const templateInput = params.templatePath ?? params.template;
  if (typeof templateInput !== 'string' || !templateInput.trim()) {
    return { ok: false, error: 'template required', errorCode: 'template_required' };
  }
  const resolved = resolveDocumentIngestExecution({ path: templateInput }, ctx);
  if (!resolved.ok) return { ok: false, error: resolved.error, errorCode: resolved.errorCode };
  const templatePath = documentIngestPhysicalPath(resolved.params);
  if (!templatePath) return { ok: false, error: 'template required', errorCode: 'template_required' };

  try {
    const { buffer, size } = fillDocx({ templatePath, data });
    ctx.variables.reportDocx = buffer;
    return { ok: true, data: { size } };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message };
  }
};
