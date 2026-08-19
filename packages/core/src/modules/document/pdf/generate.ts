import type { ConnectorContext, ConnectorResult } from '../../types.js';

export async function pdfGenerate(
  params: Record<string, unknown>,
  ctx: ConnectorContext,
): Promise<ConnectorResult> {
  const html =
    (params.html as string) ?? (ctx.variables.documentHtml as string) ?? '<html><body>Report</body></html>';
  ctx.variables.documentHtml = html;
  return { ok: true, data: { html, needsDesktopPrint: true } };
}
