import type { TableArtifact } from '../../../contracts/artifacts/table.js';
import {
  HttpResponseArtifactSchema,
  httpResponseToTable,
} from '../../../contracts/artifacts/http-response.js';
import { TransformExprSchema } from '../../../workflow/transform-expr/dsl.js';
import { evaluateTransformExpr } from '../../../workflow/transform-expr/evaluator.js';
import type { ConnectorContext, ConnectorResult } from '../../types.js';
import { normalizeTableInput } from './input.js';
import { documentToText, tableToText } from './text.js';

export async function executeTransformAction(
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
    case 'http_to_table': {
      const response = params.response;
      if (response == null) {
        return { ok: false, error: 'http_response_required', errorCode: 'http_response_required' };
      }
      const parsedResponse = HttpResponseArtifactSchema.safeParse(response);
      if (!parsedResponse.success) {
        return { ok: false, error: 'http_response_invalid', errorCode: 'http_response_invalid' };
      }
      const sourceId = typeof params.sourceId === 'string' && params.sourceId.trim()
        ? params.sourceId.trim()
        : 'http:response';
      const rowsPath = typeof params.rowsPath === 'string' ? params.rowsPath : undefined;
      const rowLimit = typeof params.rowLimit === 'number' && Number.isFinite(params.rowLimit)
        ? params.rowLimit
        : undefined;
      const result = httpResponseToTable(parsedResponse.data, {
        sourceId,
        rowsPath,
        rowLimit,
      });
      if (!result.ok) return { ok: false, error: result.errorCode, errorCode: result.errorCode };
      ctx.variables[sourceId] = result.table;
      return { ok: true, data: result.table };
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
      let value: unknown;
      try {
        value = evaluateTransformExpr(parsedExpr.data, snapshots);
      } catch (error) {
        const errorCode = error instanceof Error && error.message === 'incomplete_table_input'
          ? 'incomplete_table_input'
          : 'transform_evaluation_failed';
        return {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
          errorCode,
        };
      }
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
