import Handlebars from 'handlebars';
import type { ConnectorContext, ConnectorResult } from '../../types.js';

export async function htmlRender(
  params: Record<string, unknown>,
  ctx: ConnectorContext,
): Promise<ConnectorResult> {
  const data = (params.data as Record<string, unknown>) ?? ctx.variables;
  const template =
    (params.template as string) ?? '<html><body><h1>{{title}}</h1><pre>{{json}}</pre></body></html>';
  const compiled = Handlebars.compile(template);
  const html = compiled({
    ...data,
    json: JSON.stringify(data, null, 2),
    title: params.title ?? 'Report',
  });
  ctx.variables.documentHtml = html;
  return { ok: true, data: { html } };
}
