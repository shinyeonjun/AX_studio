import type { ReportPlan, ReportSourceSnapshot } from '../../plan/schema.js';
import { fieldPaths, reportJoinKey, valueAtPath } from '../../plan/value.js';

type JoinableReportDataset = {
  baseSource: string;
  joins: ReportPlan['joins'];
  filter?: ReportPlan['filter'];
};

function referencedSourceAliases(
  plan: ReportPlan,
  dataset: JoinableReportDataset,
  datasetId?: string,
): Set<string> {
  // Join predicates run while each join is materialized. Inferring a missing
  // source from such a predicate and appending it later would change the
  // predicate's evaluation order, so only output/filter references are
  // eligible for this bounded repair.
  const fragments: unknown[] = [dataset.filter];
  for (const scalar of plan.scalars) {
    if (scalar.dataset === datasetId) fragments.push(scalar.expression);
  }
  for (const table of plan.tables) {
    if (table.kind === 'aggregate' && table.dataset === datasetId) {
      fragments.push(table.filter, table.groupBy, table.columns);
    }
  }
  return new Set([...fieldPaths(fragments)].flatMap((path) => {
    const alias = path.split('.')[0];
    return alias ? [alias] : [];
  }));
}

type InferredJoin = {
  source: string;
  left: string;
  right: string;
  type: 'left';
  cardinality: 'one';
};

type JoinCandidate = InferredJoin & {
  score: number;
  overlap: number;
};

function rowFieldValue(row: Record<string, unknown>, path: string): unknown {
  return valueAtPath(row, path);
}

function joinKey(value: unknown): string | undefined {
  // Must match the executor's join identity or an inferred join would not match at run time.
  return reportJoinKey(value) ?? undefined;
}

function inferMissingJoin(
  missingAlias: string,
  sources: Record<string, ReportSourceSnapshot>,
  availableAliases: Set<string>,
): JoinCandidate | undefined {
  const target = sources[missingAlias];
  if (!target || !target.complete || target.rows.length === 0) return undefined;
  const candidates: JoinCandidate[] = [];
  for (const parentAlias of availableAliases) {
    const parent = sources[parentAlias];
    if (!parent || !parent.complete || parent.rows.length === 0) continue;
    const parentFields = new Set(parent.rows.flatMap((row) => Object.keys(row)));
    const targetFields = new Set(target.rows.flatMap((row) => Object.keys(row)));
    for (const parentField of parentFields) {
      if (!parentField.endsWith('_id')) continue;
      const targetField = targetFields.has(parentField)
        ? parentField
        : parentField === `${missingAlias.replace(/s$/u, '')}_id` && targetFields.has('id')
          ? 'id'
          : undefined;
      if (!targetField) continue;
      const targetKeys = new Map<string | number | boolean, number>();
      for (const row of target.rows) {
        const key = joinKey(rowFieldValue(row, targetField));
        if (key === undefined) continue;
        targetKeys.set(key, (targetKeys.get(key) ?? 0) + 1);
      }
      // An inferred one-to-one dimension must not multiply fact rows. If the
      // captured target has duplicate keys, leave the decision to the model.
      if ([...targetKeys.values()].some((count) => count > 1)) continue;
      const parentKeys = new Set<string | number | boolean>();
      for (const row of parent.rows) {
        const key = joinKey(rowFieldValue(row, parentField));
        if (key !== undefined) parentKeys.add(key);
      }
      const overlap = [...parentKeys].filter((key) => targetKeys.has(key)).length;
      if (overlap === 0) continue;
      const coverage = overlap / parentKeys.size;
      // A single coincidental match in a large parent source is too weak to
      // justify changing the user's plan. Small captured samples may still
      // contain one key, so allow a complete match or at least half coverage.
      if (parentKeys.size > 1 && coverage < 0.5) continue;
      const exact = targetField === parentField;
      candidates.push({
        source: missingAlias,
        left: `${parentAlias}.${parentField}`,
        right: targetField,
        type: 'left',
        cardinality: 'one',
        score: (exact ? 100 : 90) + coverage * 10,
        overlap,
      });
    }
  }
  candidates.sort((left, right) => right.score - left.score || right.overlap - left.overlap
    || left.left.localeCompare(right.left) || left.right.localeCompare(right.right));
  const best = candidates[0];
  if (!best) return undefined;
  const tied = candidates.filter((candidate) => Math.abs(candidate.score - best.score) < 0.0001
    && (candidate.left !== best.left || candidate.right !== best.right));
  return tied.length === 0 ? best : undefined;
}

/**
 * Repair a common model omission only when the captured snapshots prove a
 * unique, non-multiplying foreign-key relationship. The function is intentionally
 * fail-closed: an unknown, duplicated, or equally plausible relationship is
 * left for the normal validation/revision path instead of silently changing
 * report semantics.
 */
export function repairReportMissingJoins(
  plan: ReportPlan,
  sources: Record<string, ReportSourceSnapshot>,
): ReportPlan {
  const repairDataset = <T extends JoinableReportDataset>(dataset: T, datasetId?: string): T => {
    let current = dataset;
    let changed = false;
    const maxRepairs = Object.keys(sources).length;
    for (let attempt = 0; attempt < maxRepairs; attempt += 1) {
      const available = new Set([current.baseSource, ...current.joins.map((join) => join.source)]);
      const referenced = referencedSourceAliases(plan, current, datasetId);
      const missing = [...referenced].filter((alias) => sources[alias] && !available.has(alias));
      if (missing.length === 0) break;
      const candidates = missing.map((alias) => inferMissingJoin(alias, sources, available))
        .filter((candidate): candidate is JoinCandidate => Boolean(candidate));
      if (candidates.length === 0) break;
      candidates.sort((left, right) => right.score - left.score || left.source.localeCompare(right.source));
      const best = candidates[0]!;
      const tied = candidates.filter((candidate) => Math.abs(candidate.score - best.score) < 0.0001
        && (candidate.source !== best.source || candidate.left !== best.left || candidate.right !== best.right));
      if (tied.length > 0) break;
      current = { ...current, joins: [...current.joins, {
        source: best.source,
        left: best.left,
        right: best.right,
        type: best.type,
        cardinality: best.cardinality,
      }] } as T;
      changed = true;
    }
    return changed ? current : dataset;
  };

  const root = repairDataset(plan);
  const datasets = (root.datasets ?? []).map((dataset) => repairDataset(dataset, dataset.id));
  const changed = root !== plan || datasets.some((dataset, index) => dataset !== plan.datasets?.[index]);
  return changed ? { ...root, datasets: datasets.length > 0 ? datasets : root.datasets } : plan;
}
