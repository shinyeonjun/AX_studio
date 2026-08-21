import { renderHtml } from '../../../../document-write/html/render.js';
import type { ConnectorContext, ConnectorResult } from '../../../types.js';
import type { DocumentActionHandler } from '../../types.js';

export const htmlRender: DocumentActionHandler = async (
  params: Record<string, unknown>,
  ctx: ConnectorContext,
): Promise<ConnectorResult> => {
  const data = (params.data as Record<string, unknown>) ?? ctx.variables;
  const { html } = renderHtml({
    template: params.template as string | undefined,
    title: params.title as string | undefined,
    data,
  });
  ctx.variables.documentHtml = html;
  return { ok: true, data: { html } };
};
