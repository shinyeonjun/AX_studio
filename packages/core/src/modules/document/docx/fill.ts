import Docxtemplater from 'docxtemplater';
import PizZip from 'pizzip';
import { readFileSync } from 'node:fs';
import type { ConnectorContext, ConnectorResult } from '../../types.js';

export async function docxFill(
  params: Record<string, unknown>,
  ctx: ConnectorContext,
): Promise<ConnectorResult> {
  const data = (params.data as Record<string, unknown>) ?? ctx.variables;
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
