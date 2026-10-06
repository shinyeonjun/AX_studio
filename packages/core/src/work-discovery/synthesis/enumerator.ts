import { randomUUID } from 'node:crypto';
import type { TableArtifact } from '../../contracts/artifacts/table.js';
import type { OutputObservation } from '../observation/schema.js';
import type { SourceDescriptor } from '../schema.js';
import type { TransformExpr } from '../../workflow/transform-expr/dsl.js';
import { evaluateTransformExpr } from '../../workflow/transform-expr/evaluator.js';
import { aggregateRows } from '../../workflow/transform-expr/evaluator/numeric.js';
import { compareObservationValue, replayPassThreshold } from './compare.js';
import { sourceIdFromExpr } from '../compile/blueprint.js';
import { aggregateSpecs, isCompleteTable, numericSourceColumns, sameNumber, specSimplicity } from './aggregate-specs.js';
import { synthesizeGroupCandidates } from './group-synthesis.js';
import { candidateRowFilters } from './row-filters.js';

export interface EnumeratedCandidate {
  id: string;
  observationPath: string;
  expr: TransformExpr;
  simplicity: number;
}

function aggregateExpr(sourceId: string, fn: 'sum' | 'count' | 'avg', column?: string, round?: number): TransformExpr {
  return {
    op: 'aggregate',
    input: { op: 'source', sourceId },
    fn,
    ...(column ? { column } : {}),
    ...(round !== undefined ? { round } : {}),
  };
}

/** Decimal places the example shows (display text first, e.g. "58,218" -> 0, "12.5%" -> 1). */
function displayedDecimals(observation: OutputObservation): number | undefined {
  if (observation.value.kind !== 'number') return undefined;
  const shown = (observation.value.display ?? String(observation.value.value)).replace(/[,\s%]/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(shown)) return undefined;
  const fraction = shown.split('.')[1];
  return fraction ? Math.min(fraction.length, 6) : 0;
}

/**
 * Ratio hypotheses grow with the square of the numeric columns; above this many columns the
 * search is skipped rather than flooding replay (bounds search, not meaning).
 */
const MAX_RATIO_COLUMNS = 8;

/**
 * A value is a ratio candidate only when the report itself formats it like one (a % sign or a
 * fractional part). Whole counts and amounts are not tried as ratios: with many column pairs a
 * rounded ratio would match an integer by coincidence.
 */
function looksLikeRatio(observation: OutputObservation): boolean {
  if (observation.value.kind !== 'number') return false;
  const shown = observation.value.display ?? String(observation.value.value);
  return observation.value.unit === '%' || shown.includes('%') || !Number.isInteger(observation.value.value);
}

/** sum(a) / sum(b), over every ordered pair of numeric columns, as shown (x100 for %) and rounded. */
function ratioCandidates(
  observation: OutputObservation,
  sourceId: string,
  columns: ReadonlyArray<{ name: string }>,
  decimals: number | undefined,
): EnumeratedCandidate[] {
  if (!looksLikeRatio(observation) || columns.length > MAX_RATIO_COLUMNS) return [];
  const shown = observation.value.kind === 'number' ? observation.value.display ?? '' : '';
  const percent = (observation.value.kind === 'number' && observation.value.unit === '%') || shown.includes('%');
  const multipliers = percent ? [100] : [1, 100];
  const candidates: EnumeratedCandidate[] = [];
  for (const numerator of columns) {
    for (const denominator of columns) {
      if (numerator.name === denominator.name) continue;
      for (const multiplyBy of multipliers) {
        const base = {
          op: 'ratio' as const,
          numerator: aggregateExpr(sourceId, 'sum', numerator.name),
          denominator: aggregateExpr(sourceId, 'sum', denominator.name),
          multiplyBy,
        };
        candidates.push({ id: candidateId(), observationPath: observation.path, expr: base, simplicity: 0.75 });
        if (decimals !== undefined) {
          candidates.push({ id: candidateId(), observationPath: observation.path, expr: { ...base, round: decimals }, simplicity: 0.73 });
        }
      }
    }
  }
  return candidates;
}

function candidateId(): string {
  return `cand_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
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
  const unfiltered = enumerateUnfilteredScalarCandidates(observations, sources, snapshots);
  const verified = enumerateVerifiedCandidates(observations, sources, snapshots, unfiltered);
  // A path whose most consistent explanation keeps only some rows drops its unfiltered family.
  return [...unfiltered.filter((candidate) => !verified.filteredPaths.has(candidate.observationPath)), ...verified.candidates];
}

/** Simplicity cost of keeping only some rows: an unfiltered rule wins when both are equally supported. */
const FILTER_SIMPLICITY_PENALTY = 0.1;

interface Explanation {
  observationPath: string;
  /** Absent for "the unfiltered scalar family already explains this number". */
  expr?: TransformExpr;
  simplicity: number;
  /** `${sourceId}|${filterKey}`; an empty filter key means every row is kept. */
  filterIdentity: string;
  filtered: boolean;
}

/**
 * Candidates built constructively and checked against the snapshot before they are emitted:
 * group rules for report tables and row-filtered aggregates for numbers. Snapshots belong to
 * the first example, so each path is synthesized from its first observation only.
 *
 * Several row filters (or none) can explain one field, e.g. a maximum no excluded row ever
 * reaches. A report applies its row condition throughout, so each field keeps the explanation
 * shared by the most report fields; on a tie keeping every row wins, and tied filters stay
 * as competing candidates (a genuine ambiguity for a person to settle).
 */
function enumerateVerifiedCandidates(
  observations: OutputObservation[],
  sources: SourceDescriptor[],
  snapshots: Record<string, TableArtifact>,
  unfiltered: EnumeratedCandidate[],
): { candidates: EnumeratedCandidate[]; filteredPaths: Set<string> } {
  const firstByPath = new Map<string, OutputObservation>();
  for (const observation of observations) {
    if (!firstByPath.has(observation.path)) firstByPath.set(observation.path, observation);
  }
  const explanations: Explanation[] = [];
  for (const observation of firstByPath.values()) {
    if (observation.value.kind === 'table') {
      for (const group of synthesizeGroupCandidates(observation.value, sources, snapshots)) {
        explanations.push({
          observationPath: observation.path,
          expr: group.expr,
          simplicity: group.filterKey ? 0.75 - FILTER_SIMPLICITY_PENALTY : 0.75,
          filterIdentity: `${group.sourceId}|${group.filterKey}`,
          filtered: group.filterKey !== '',
        });
      }
    } else if (observation.value.kind === 'number') {
      for (const sourceId of sourcesExplainingWithoutFilter(observation, unfiltered, snapshots)) {
        explanations.push({ observationPath: observation.path, simplicity: 1, filterIdentity: `${sourceId}|`, filtered: false });
      }
      explanations.push(...filteredScalarCandidates(observation, sources, snapshots));
    }
  }
  const support = new Map<string, Set<string>>();
  for (const explanation of explanations) {
    const paths = support.get(explanation.filterIdentity) ?? new Set<string>();
    paths.add(explanation.observationPath);
    support.set(explanation.filterIdentity, paths);
  }
  const rank = (explanation: Explanation): number =>
    support.get(explanation.filterIdentity)!.size * 2 + (explanation.filtered ? 0 : 1);
  const bestRankByPath = new Map<string, number>();
  for (const explanation of explanations) {
    bestRankByPath.set(explanation.observationPath, Math.max(bestRankByPath.get(explanation.observationPath) ?? 0, rank(explanation)));
  }
  const chosen = explanations.filter((explanation) => rank(explanation) === bestRankByPath.get(explanation.observationPath));
  return {
    filteredPaths: new Set(chosen.filter((explanation) => explanation.filtered).map((explanation) => explanation.observationPath)),
    candidates: chosen.flatMap((explanation) => explanation.expr ? [{
      id: candidateId(),
      observationPath: explanation.observationPath,
      expr: explanation.expr,
      simplicity: explanation.simplicity,
    }] : []),
  };
}

function sourcesExplainingWithoutFilter(
  observation: OutputObservation,
  unfiltered: EnumeratedCandidate[],
  snapshots: Record<string, TableArtifact>,
): Set<string> {
  const sourceIds = new Set<string>();
  for (const candidate of unfiltered) {
    if (candidate.observationPath !== observation.path) continue;
    const sourceId = sourceIdFromExpr(candidate.expr);
    if (!sourceId || sourceIds.has(sourceId)) continue;
    try {
      if (replayPassThreshold(compareObservationValue(observation.value, evaluateTransformExpr(candidate.expr, snapshots)))) {
        sourceIds.add(sourceId);
      }
    } catch {
      // Not an explanation.
    }
  }
  return sourceIds;
}

function filteredScalarCandidates(
  observation: OutputObservation,
  sources: SourceDescriptor[],
  snapshots: Record<string, TableArtifact>,
): Explanation[] {
  if (observation.value.kind !== 'number') return [];
  const expected = observation.value.value;
  const decimals = displayedDecimals(observation);
  const found: Explanation[] = [];
  for (const source of sources) {
    const table = Object.hasOwn(snapshots, source.id) ? snapshots[source.id] : undefined;
    if (!table || !isCompleteTable(table)) continue;
    // Same aggregate family as the unfiltered scalar candidates.
    const specs = aggregateSpecs(numericSourceColumns(table), decimals).filter((spec) => spec.fn !== 'min' && spec.fn !== 'max');
    for (const filter of candidateRowFilters(table, new Set())) {
      // The simplest spec that reproduces the number under this filter.
      const spec = specs.find((entry) => sameNumber(aggregateRows(filter.rows, entry), expected));
      if (spec) {
        found.push({
          observationPath: observation.path,
          expr: {
            op: 'aggregate',
            input: { op: 'filter', input: { op: 'source', sourceId: source.id }, where: filter.where },
            ...spec,
          },
          simplicity: specSimplicity(spec) - FILTER_SIMPLICITY_PENALTY,
          filterIdentity: `${source.id}|${filter.key}`,
          filtered: true,
        });
      }
    }
  }
  return found;
}

function enumerateUnfilteredScalarCandidates(
  observations: OutputObservation[],
  sources: SourceDescriptor[],
  snapshots: Record<string, TableArtifact>,
): EnumeratedCandidate[] {
  const candidates: EnumeratedCandidate[] = [];
  const numericObservations = observations.filter((observation) => observation.value.kind === 'number');

  for (const observation of numericObservations) {
    const decimals = displayedDecimals(observation);
    for (const source of sources) {
      const table = snapshots[source.id];
      if (!table) continue;

      candidates.push({
        id: candidateId(),
        observationPath: observation.path,
        expr: aggregateExpr(source.id, 'count'),
        simplicity: 0.65,
      });

      const columns = numericColumns(table);
      for (const column of columns) {
        // A column is one number only when the table has one row; on a longer table it is a list
        // that can never equal a number, and replaying it would persist every value of the column.
        if (table.rows.length === 1) {
          candidates.push({
            id: candidateId(),
            observationPath: observation.path,
            expr: { op: 'column', input: { op: 'source', sourceId: source.id }, name: column.name },
            simplicity: 0.8,
          });
        }

        for (const fn of ['sum', 'avg'] as const) {
          candidates.push({
            id: candidateId(),
            observationPath: observation.path,
            expr: aggregateExpr(source.id, fn, column.name),
            simplicity: fn === 'sum' ? 0.7 : 0.6,
          });
        }
        // Reports show averages rounded ("58,218"); an exact average then never matches.
        if (decimals !== undefined) {
          candidates.push({
            id: candidateId(),
            observationPath: observation.path,
            expr: aggregateExpr(source.id, 'avg', column.name, decimals),
            simplicity: 0.58,
          });
        }
      }

      candidates.push(...ratioCandidates(observation, source.id, columns, decimals));
    }
  }

  return candidates;
}
