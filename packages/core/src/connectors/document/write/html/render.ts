import { renderHtml } from '../../../../documents/write/html/render.js';
import type { ConnectorContext, ConnectorResult } from '../../../types.js';
import type { DocumentActionHandler } from '../../types.js';

/** Only the explicit `data` param reaches the template; workflow variables never do implicitly. */
function templateData(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === 'string' && value.trim()) return { content: value };
  return {};
}

export const htmlRender: DocumentActionHandler = async (
  params: Record<string, unknown>,
  ctx: ConnectorContext,
): Promise<ConnectorResult> => {
  const template =
    typeof params.template === 'string'
      ? params.template
      : typeof ctx.variables.templateHtml === 'string'
        ? ctx.variables.templateHtml
        : undefined;
  let html: string;
  try {
    ({ html } = renderHtml({
      template,
      title: typeof params.title === 'string' ? params.title : undefined,
      data: templateData(params.data),
    }));
  } catch (error) {
    // Handlebars strict-mode errors name the missing field, never a data value.
    const detail = error instanceof Error ? error.message.split('\n', 1)[0] : String(error);
    return { ok: false, error: `html_template_render_failed: ${detail}`, errorCode: 'invalid_params' };
  }
  ctx.variables.documentHtml = html;
  return { ok: true, data: { html } };
};
