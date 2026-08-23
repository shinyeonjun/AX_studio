import type { TableArtifact } from '../../contracts/artifacts/table.js';
import type { OutputObservation } from '../observation/schema.js';
import type { CandidateProgram } from '../schema.js';
import { sourceIdFromExpr } from '../compile/blueprint.js';
import type { EnumeratedCandidate } from './enumerator.js';
import { compareObservationValue, replayPassThreshold } from './compare.js';
import { evaluateTransformExpr, type SnapshotTables } from './transform-evaluator.js';
import type { TransformExpr } from './transform-dsl.js';

export interface ReplayExample {
  exampleId: string;
  observations: OutputObservation[];
}

function isAggregateExpr(expr: TransformExpr): boolean {
  return expr.op === 'aggregate' || expr.op === 'ratio';
}

function usesTruncatedSnapshot(expr: TransformExpr, snapshots: SnapshotTables): boolean {
  if (expr.op === 'source') {
    return snapshots[expr.sourceId]?.truncated === true;
  }
  if (expr.op === 'ratio') {
    return usesTruncatedSnapshot(expr.numerator, snapshots) || usesTruncatedSnapshot(expr.denominator, snapshots);
  }
  if ('input' in expr) {
    return usesTruncatedSnapshot(expr.input, snapshots);
  }
  return false;
}

function snapshotsForCandidate(expr: TransformExpr, snapshots: SnapshotTables): SnapshotTables {
  const sourceId = sourceIdFromExpr(expr);
  if (!sourceId) return snapshots;
  const table = snapshots[sourceId];
  return table ? { [sourceId]: table } : snapshots;
}

export function replayCandidates(params: {
  candidates: EnumeratedCandidate[];
  examples: ReplayExample[];
  snapshotsByExample: Record<string, Record<string, TableArtifact>>;
}): CandidateProgram[] {
  const results: CandidateProgram[] = [];

  for (const candidate of params.candidates) {
    const replayResults: CandidateProgram['replayResults'] = [];
    let replayScore = 0;

    for (const example of params.examples) {
      const observation = example.observations.find((entry) => entry.path === candidate.observationPath);
      if (!observation || !observation.required) continue;
      const snapshots = snapshotsForCandidate(
        candidate.expr,
        params.snapshotsByExample[example.exampleId] ?? {},
      );
      if (isAggregateExpr(candidate.expr) && usesTruncatedSnapshot(candidate.expr, snapshots)) {
        replayResults.push({
          exampleId: example.exampleId,
          expected: observation.value,
          actual: null,
          match: 0,
          pass: false,
        });
        continue;
      }
      let actual: unknown;
      try {
        actual = evaluateTransformExpr(candidate.expr, snapshots);
      } catch {
        actual = null;
      }
      const match = compareObservationValue(observation.value, actual as never);
      const pass = replayPassThreshold(match);
      replayResults.push({
        exampleId: example.exampleId,
        expected: observation.value,
        actual,
        match,
        pass,
      });
      replayScore += match;
    }

    const replayCount = replayResults.length;
    const replay = replayCount > 0 ? replayScore / replayCount : 0;
    const passedAll = replayCount > 0 && replayResults.every((entry) => entry.pass);
    const total = replay * 0.85 + candidate.simplicity * 0.15;
    results.push({
      id: candidate.id,
      observationPath: candidate.observationPath,
      expr: candidate.expr,
      score: {
        total,
        replay,
        semantic: replay,
        simplicity: candidate.simplicity,
      },
      replayResults,
      status: passedAll ? 'accepted' : 'candidate',
    });
  }

  return results.sort((left, right) => right.score.total - left.score.total);
}
