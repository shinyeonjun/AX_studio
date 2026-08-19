import Handlebars from 'handlebars';
import Docxtemplater from 'docxtemplater';
import PizZip from 'pizzip';
import { readFileSync } from 'node:fs';
import type { Connector, ConnectorContext, ConnectorResult } from '../types.js';

export class ReportConnector implements Connector {
  name = 'report';

  async execute(action: string, params: Record<string, unknown>, ctx: ConnectorContext): Promise<ConnectorResult> {
    const data = (params.data as Record<string, unknown>) ?? ctx.variables;

    if (action === 'html.render') {
      const template = (params.template as string) ?? '<html><body><h1>{{title}}</h1><pre>{{json}}</pre></body></html>';
      const compiled = Handlebars.compile(template);
      const html = compiled({ ...data, json: JSON.stringify(data, null, 2), title: params.title ?? 'Report' });
      ctx.variables.reportHtml = html;
      return { ok: true, data: { html } };
    }

    if (action === 'docx.fill') {
      const path = params.templatePath as string;
      if (!path) return { ok: false, error: 'templatePath required' };
      const content = readFileSync(path);
      const zip = new PizZip(content);
      const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true });
      doc.render(data);
      const buf = doc.getZip().generate({ type: 'nodebuffer' });
      ctx.variables.reportDocx = buf;
      return { ok: true, data: { size: buf.length } };
    }

    if (action === 'pdf.generate') {
      const html = (params.html as string) ?? (ctx.variables.reportHtml as string) ?? '<html><body>Report</body></html>';
      ctx.variables.reportHtml = html;
      return { ok: true, data: { html, needsDesktopPrint: true } };
    }

    return { ok: false, error: `Unknown report action: ${action}` };
  }
}
