import { randomUUID } from 'node:crypto';
import type { TableArtifact } from '../../contracts/artifacts/table.js';
import type { OutputObservation } from '../observation/schema.js';
import type { SourceDescriptor } from '../schema.js';
import type { TransformExpr } from './transform-dsl.js';

export interface EnumeratedCandidate {
  id: string;
  observationPath: string;
  expr: TransformExpr;
  simplicity: number;
}

function aggregateExpr(sourceId: string, fn: 'sum' | 'count' | 'avg', column?: string): TransformExpr {
  return {
    op: 'aggregate',
    input: { op: 'source', sourceId },
    fn,
    ...(column ? { column } : {}),
  };
}

export function enumerateCandidates(
  observations: OutputObservation[],
  sources: SourceDescriptor[],
  snapshots: Record<string, TableArtifact>,
): EnumeratedCandidate[] {
  const candidates: EnumeratedCandidate[] = [];
  const numericObservations = observations.filter((observation) => observation.value.kind === 'number');

  for (const observation of numericObservations) {
    for (const source of sources) {
      const table = snapshots[source.id];
      if (!table) continue;
      for (const column of table.columns) {
        if (column.type !== 'number' && column.type !== 'integer' && column.type !== 'currency') continue;

        const direct: TransformExpr = {
          op: 'column',
          input: { op: 'source', sourceId: source.id },
          name: column.name,
        };
        candidates.push({
          id: `cand_${randomUUID().replace(/-/g, '').slice(0, 12)}`,
          observationPath: observation.path,
          expr: direct,
          simplicity: 0.8,
        });

        for (const fn of ['sum', 'count', 'avg'] as const) {
          candidates.push({
            id: `cand_${randomUUID().replace(/-/g, '').slice(0, 12)}`,
            observationPath: observation.path,
            expr: aggregateExpr(source.id, fn, column.name),
            simplicity: fn === 'sum' ? 0.7 : 0.6,
          });
        }
      }
    }
  }

  return candidates;
}
