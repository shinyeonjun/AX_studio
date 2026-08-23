import type { TableArtifact } from '../../contracts/artifacts/table.js';
import type { OutputObservation } from '../observation/schema.js';
import type { CandidateProgram } from '../schema.js';
import type { EnumeratedCandidate } from './enumerator.js';
import { compareObservationValue, evaluateTransformExpr } from './transform-evaluator.js';

export interface ReplayExample {
  exampleId: string;
  observations: OutputObservation[];
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
    let replayCount = 0;

    for (const example of params.examples) {
      const observation = example.observations.find((entry) => entry.path === candidate.observationPath);
      if (!observation || observation.value.kind !== 'number') continue;
      const snapshots = params.snapshotsByExample[example.exampleId] ?? {};
      let actual: unknown;
      try {
        actual = evaluateTransformExpr(candidate.expr, snapshots);
      } catch {
        actual = null;
      }
      const match = compareObservationValue(observation.value.value, actual as never);
      const pass = match >= 0.95;
      replayResults.push({
        exampleId: example.exampleId,
        expected: observation.value.value,
        actual,
        match,
        pass,
      });
      replayScore += match;
      replayCount += 1;
    }

    const replay = replayCount > 0 ? replayScore / replayCount : 0;
    const total = replay * 0.85 + candidate.simplicity * 0.15;
    const accepted = replayResults.some((entry) => entry.pass);
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
      status: accepted ? 'accepted' : 'candidate',
    });
  }

  return results.sort((left, right) => right.score.total - left.score.total);
}
