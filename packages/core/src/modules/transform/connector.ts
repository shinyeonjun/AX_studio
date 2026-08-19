import type { Connector, ConnectorContext, ConnectorResult } from '../types.js';

function formatTableValue(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

function tableToText(table: unknown): string {
  if (!Array.isArray(table) || table.length === 0) return '';

  const first = table[0];
  if (Array.isArray(first)) {
    return (table as unknown[][])
      .map((row) => row.map((cell) => formatTableValue(cell)).join('\t'))
      .join('\n');
  }

  if (first && typeof first === 'object') {
    const rows = table as Record<string, unknown>[];
    const headers = Object.keys(rows[0] ?? {});
    const lines = [headers.join('\t')];
    for (const row of rows) {
      lines.push(headers.map((header) => formatTableValue(row[header])).join('\t'));
    }
    return lines.join('\n');
  }

  return table.map((row) => formatTableValue(row)).join('\n');
}

function documentToText(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  const record = value as Record<string, unknown>;
  if (typeof record.text === 'string' && record.text.trim()) return record.text;
  const pages = Array.isArray(record.pages) ? record.pages : [];
  const pageText = pages
    .map((page) => {
      if (!page || typeof page !== 'object') return '';
      const text = (page as Record<string, unknown>).text;
      return typeof text === 'string' ? text : '';
    })
    .filter(Boolean)
    .join('\n\n');
  return pageText.trim();
}

function latestTableFromResults(stepResults: Record<string, unknown>): unknown {
  for (const value of Object.values(stepResults).reverse()) {
    if (Array.isArray(value) && value.length > 0) return value;
  }
  return undefined;
}

function latestDocumentFromResults(stepResults: Record<string, unknown>): unknown {
  for (const value of Object.values(stepResults).reverse()) {
    if (value && typeof value === 'object' && ('pages' in value || 'text' in value || 'artifactPath' in value)) {
      return value;
    }
  }
  return undefined;
}

export class TransformConnector implements Connector {
  name = 'transform';

  async execute(
    action: string,
    params: Record<string, unknown>,
    ctx: ConnectorContext,
  ): Promise<ConnectorResult> {
    switch (action) {
      case 'table_to_text': {
        const table =
          params.table ??
          (typeof params.sourceStep === 'string' ? ctx.variables[`${params.sourceStep}_result`] : undefined) ??
          ctx.variables.sheetData ??
          ctx.variables.queryResult ??
          latestTableFromResults(ctx.variables as Record<string, unknown>);
        const text = tableToText(table);
        ctx.variables.transformText = text;
        return { ok: true, data: { text, kind: 'TextArtifact' } };
      }
      case 'document_to_text': {
        const document =
          params.document ??
          (typeof params.sourceStep === 'string' ? ctx.variables[`${params.sourceStep}_result`] : undefined) ??
          latestDocumentFromResults(ctx.variables as Record<string, unknown>);
        const text = documentToText(document);
        ctx.variables.transformText = text;
        return { ok: true, data: { text, kind: 'TextArtifact' } };
      }
      default:
        return { ok: false, error: `Unknown transform action: ${action}` };
    }
  }
}
