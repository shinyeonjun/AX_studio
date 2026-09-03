import type { TransformExpr } from '../dsl.js';
import type { SnapshotTables, TransformEvaluation } from './contracts.js';
import { evaluateLookup } from './lookup.js';
import { evaluateAggregate, evaluateRatio } from './numeric.js';
import { evaluateSource } from './source.js';
import {
  evaluateColumn,
  evaluateFilter,
  evaluateLimit,
  evaluateSelect,
  evaluateSort,
} from './table.js';

export function evaluateTransformExpr(
  expr: TransformExpr,
  snapshots: SnapshotTables,
): TransformEvaluation {
  switch (expr.op) {
    case 'source':
      return evaluateSource(expr, snapshots);
    case 'column':
      return evaluateColumn(expr, snapshots, evaluateTransformExpr);
    case 'filter':
      return evaluateFilter(expr, snapshots, evaluateTransformExpr);
    case 'aggregate':
      return evaluateAggregate(expr, snapshots, evaluateTransformExpr);
    case 'ratio':
      return evaluateRatio(expr, snapshots, evaluateTransformExpr);
    case 'lookup':
      return evaluateLookup(expr, snapshots, evaluateTransformExpr);
    case 'select':
      return evaluateSelect(expr, snapshots, evaluateTransformExpr);
    case 'sort':
      return evaluateSort(expr, snapshots, evaluateTransformExpr);
    case 'limit':
      return evaluateLimit(expr, snapshots, evaluateTransformExpr);
    default:
      throw new Error('unsupported_transform_op');
  }
}
