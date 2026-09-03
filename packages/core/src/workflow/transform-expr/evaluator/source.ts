import type { TransformExpr } from '../dsl.js';
import type { SnapshotTables, TransformEvaluation } from './contracts.js';

export function evaluateSource(
  expr: Extract<TransformExpr, { op: 'source' }>,
  snapshots: SnapshotTables,
): TransformEvaluation {
  const table = snapshots[expr.sourceId];
  if (!table) throw new Error(`snapshot_not_found:${expr.sourceId}`);
  return table;
}
