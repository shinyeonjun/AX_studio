import type { TransformExpr } from '../../../../../workflow/transform-expr/dsl.js';
import type { AxCommand, AxCommandResult } from '../../schema.js';
import { httpTableConversion } from './index.js';

/** The source id chat table shaping reads from (see jev-table-transform). */
export const CHAT_READ_SOURCE_ID = 'chat:read-result';

/**
 * How a chat read answer was produced, precisely enough to produce it again on fresh data:
 * the read that ran (an HTTP GET and how its response became a table, or a database table
 * read), and the table shaping (filter, sort, columns, a calculation) applied to it. Only
 * reads that can be repeated exactly get one.
 */
export type ChatReadRecipe =
  | {
    kind: 'http_table';
    params: Record<string, unknown>;
    rowsPath?: string;
    columns?: string[];
    /** Over `{ op: 'source', sourceId: CHAT_READ_SOURCE_ID }`; absent when the table was shown as read. */
    expression?: TransformExpr;
  }
  | {
    kind: 'rdb_table';
    /** The `rdb.query.read` parameters that ran. */
    params: Record<string, unknown>;
    expression?: TransformExpr;
  };

export function chatReadRecipe(command: AxCommand, result: AxCommandResult, expression?: TransformExpr): ChatReadRecipe | undefined {
  if (command.name !== 'capability.invoke') return undefined;
  if (command.args.id === 'rdb.query.read') {
    const params = command.args.params;
    if (result.status !== 'ok' || !params || typeof params !== 'object' || Array.isArray(params)) return undefined;
    return { kind: 'rdb_table', params: structuredClone(params as Record<string, unknown>), ...(expression ? { expression } : {}) };
  }
  if (command.args.id !== 'http.request') return undefined;
  const params = command.args.params;
  if (!params || typeof params !== 'object' || Array.isArray(params)) return undefined;
  const method = String((params as Record<string, unknown>).method ?? 'GET').toUpperCase();
  if (method !== 'GET') return undefined;
  const conversion = httpTableConversion(command, result);
  if (!conversion) return undefined;
  return {
    kind: 'http_table',
    params: structuredClone(params as Record<string, unknown>),
    ...conversion,
    ...(expression ? { expression } : {}),
  };
}

function substituteSource(expr: TransformExpr, replacement: TransformExpr): TransformExpr {
  if (expr.op === 'source') return expr.sourceId === CHAT_READ_SOURCE_ID ? replacement : expr;
  if (expr.op === 'ratio') {
    return { ...expr, numerator: substituteSource(expr.numerator, replacement), denominator: substituteSource(expr.denominator, replacement) };
  }
  return { ...expr, input: substituteSource(expr.input, replacement) } as TransformExpr;
}

/** The recipe of an answer that reshaped an earlier answer: the earlier shaping, then this one. */
export function thenTransform(recipe: ChatReadRecipe, expression: TransformExpr): ChatReadRecipe {
  return {
    ...recipe,
    expression: recipe.expression ? substituteSource(expression, recipe.expression) : expression,
  };
}
