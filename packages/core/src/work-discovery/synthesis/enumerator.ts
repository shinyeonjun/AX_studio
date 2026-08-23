import { randomUUID } from 'node:crypto';
import type { TableArtifact } from '../../contracts/artifacts/table.js';
import type { OutputObservation } from '../observation/schema.js';
import type { SourceDescriptor } from '../schema.js';
import type { TransformExpr } from '../../workflow/transform-expr/dsl.js';

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

function numericColumns(table: TableArtifact): Array<{ name: string; type: string }> {
  return table.columns.filter((column) =>
    column.type === 'number' ||
    column.type === 'integer' ||
    column.type === 'currency' ||
    column.type === 'percentage',
  );
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

      candidates.push({
        id: `cand_${randomUUID().replace(/-/g, '').slice(0, 12)}`,
        observationPath: observation.path,
        expr: aggregateExpr(source.id, 'count'),
        simplicity: 0.65,
      });

      for (const column of numericColumns(table)) {
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

        for (const fn of ['sum', 'avg'] as const) {
          candidates.push({
            id: `cand_${randomUUID().replace(/-/g, '').slice(0, 12)}`,
            observationPath: observation.path,
            expr: aggregateExpr(source.id, fn, column.name),
            simplicity: fn === 'sum' ? 0.7 : 0.6,
          });
        }
      }

      const actual = table.columns.find((column) => /actual/i.test(column.name));
      const target = table.columns.find((column) => /target/i.test(column.name));
      if (actual && target) {
        candidates.push({
          id: `cand_${randomUUID().replace(/-/g, '').slice(0, 12)}`,
          observationPath: observation.path,
          expr: {
            op: 'ratio',
            numerator: aggregateExpr(source.id, 'sum', actual.name),
            denominator: aggregateExpr(source.id, 'sum', target.name),
            multiplyBy: 100,
          },
          simplicity: 0.75,
        });
      }
    }
  }

  return candidates;
}
