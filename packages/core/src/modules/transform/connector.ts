import type { Connector, ConnectorContext, ConnectorResult } from '../types.js';
import { TransformExprSchema } from '../../workflow/transform-expr/dsl.js';
import { evaluateTransformExpr } from '../../workflow/transform-expr/evaluator.js';
import { buildTableArtifact } from '../../contracts/artifacts/table-build.js';
import { TableArtifactSchema, type TableArtifact } from '../../contracts/artifacts/table.js';

function normalizeTableInput(value: unknown, sourceId: string): TableArtifact | undefined {
  const artifact = TableArtifactSchema.safeParse(value);
  if (artifact.success) return artifact.data;
  if (!Array.isArray(value)) return undefined;

  const rows = value.filter(
    (row): row is Record<string, unknown> =>
      Boolean(row) && typeof row === 'object' && !Array.isArray(row),
  );
  if (rows.length !== value.length) return undefined;

  const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  return buildTableArtifact({
    id: `runtime_${sourceId}`,
    headers,
    matrix: rows.map((row) => headers.map((header) => row[header])),
    source: sourceId.startsWith('rdb:') ? { table: sourceId.slice('rdb:'.length) } : undefined,
  });
}

function formatTableValue(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

function tableToText(table: unknown): string {
  const artifact = TableArtifactSchema.safeParse(table);
  if (artifact.success) {
    const headers = artifact.data.columns.map((column) => column.name);
    if (headers.length === 0) return '';
    return [
      headers.join('\t'),
      ...artifact.data.rows.map((row) =>
        headers.map((header) => formatTableValue(row.values[header])).join('\t'),
      ),
    ].join('\n');
  }

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

export class TransformConnector implements Connector {
  name = 'transform';

  async execute(
    action: string,
    params: Record<string, unknown>,
    ctx: ConnectorContext,
  ): Promise<ConnectorResult> {
    switch (action) {
      case 'table_to_text': {
        const table = params.table;
        if (table == null) {
          return { ok: false, error: 'table_input_required', errorCode: 'table_input_required' };
        }
        const text = tableToText(table);
        ctx.variables.transformText = text;
        return { ok: true, data: { text, kind: 'TextArtifact' } };
      }
      case 'document_to_text': {
        const document = params.document;
        if (document == null) {
          return { ok: false, error: 'document_input_required', errorCode: 'document_input_required' };
        }
        const text = documentToText(document);
        ctx.variables.transformText = text;
        return { ok: true, data: { text, kind: 'TextArtifact' } };
      }
      case 'evaluate': {
        const parsedExpr = TransformExprSchema.safeParse(params.expr);
        if (!parsedExpr.success) {
          return { ok: false, error: 'invalid_transform_expr', errorCode: 'invalid_transform_expr' };
        }
        if (params.table == null) {
          return { ok: false, error: 'table_input_required', errorCode: 'table_input_required' };
        }
        const sourceId = typeof params.discoverySourceId === 'string'
          ? params.discoverySourceId
          : 'runtime:source';
        const table = normalizeTableInput(params.table, sourceId);
        if (!table) {
          return { ok: false, error: 'table_input_invalid', errorCode: 'table_input_invalid' };
        }
        const snapshots: Record<string, TableArtifact> = { [sourceId]: table };
        if (params.tables && typeof params.tables === 'object' && !Array.isArray(params.tables)) {
          for (const [tableSourceId, value] of Object.entries(params.tables as Record<string, unknown>)) {
            const normalized = normalizeTableInput(value, tableSourceId);
            if (normalized) snapshots[tableSourceId] = normalized;
          }
        }
        const value = evaluateTransformExpr(parsedExpr.data, snapshots);
        const outputPath = typeof params.outputPath === 'string' ? params.outputPath : 'result';
        ctx.variables[outputPath] = value;
        ctx.variables.discoveryFields ??= {};
        (ctx.variables.discoveryFields as Record<string, unknown>)[outputPath] = value;
        return { ok: true, data: { value, outputPath, kind: 'JsonArtifact' } };
      }
      default:
        return { ok: false, error: `Unknown transform action: ${action}` };
    }
  }
}
