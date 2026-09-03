import type { ScalarValue, TableArtifact } from '../../../contracts/artifacts/table.js';
import type { TransformExpr } from '../dsl.js';

export type SnapshotTables = Record<string, TableArtifact>;
export type TransformEvaluation = ScalarValue | TableArtifact;
export type TransformEvaluator = (
  expr: TransformExpr,
  snapshots: SnapshotTables,
) => TransformEvaluation;
