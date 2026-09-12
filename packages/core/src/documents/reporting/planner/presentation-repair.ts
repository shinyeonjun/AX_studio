import type { PdfReportPairAnalysis } from '../../read/types/pdf.js';
import type { ModelImageInput } from '../../../intelligence/agent/model/provider.js';
import type { ReportLayoutPlan, ReportLayoutValue } from '../layout/schema.js';
import type {
  ReportFormat,
  ReportPlan,
  ReportPrimitive,
  ReportScalarExpression,
  ReportSourceSnapshot,
} from '../plan/schema.js';
import type { ReportPlanResult } from '../plan/execute.js';
import type { ReportSourceCapturePlan } from '../source/schema.js';
import { comparable, fieldPaths, isRecordValue, valueAtPath } from '../plan/value.js';
import { normalizeReportText } from '../plan/reusability.js';
import { formatFromExampleText } from './replay-repair.js';

function sampleCalculationRows<T>(rows: T[]): T[] {
  if (rows.length <= 6) return rows;
  return [...rows.slice(0, 3), ...rows.slice(-3)];
}

/**
 * A model-supplied format is only a hypothesis. Once a binding has been
 * matched to a completed-example cell, the cell's rendered shape is the
 * stronger contract. Reconcile incompatible formats before execution so a
 * text value cannot reach the numeric formatter (and vice versa).
 */
function reconcileExampleFormat(expected: string, current?: ReportFormat): ReportFormat | undefined {
  const inferred = formatFromExampleText(expected);
  if (current === undefined) return inferred;
  if (inferred === undefined) {
    // Unknown prose is safe to treat as text only when the model selected a
    // numeric/date style. Date-like prose such as "2026년 8월" is deliberately
    // left alone because it is a valid human date representation that the
    // compact parser cannot classify.
    const normalized = normalizeReportText(expected);
    const dateLike = /(?:^|\D)\d{4}\D+\d{1,2}(?:\D+\d{1,2})?(?:$|\D)/u.test(normalized);
    if (current.style === 'text' || (current.style === 'date' && dateLike)) return current;
    return { style: 'text' };
  }
  if (current.style === inferred.style) return current;
  // Preserve deliberate affixes, but take the numeric family and precision
  // from the example so the renderer emits the same kind of value.
  return {
    ...inferred,
    ...(current.prefix !== undefined ? { prefix: current.prefix } : {}),
    ...(current.suffix !== undefined ? { suffix: current.suffix } : {}),
  };
}

/** The completed example is authoritative for presentation style. */
export function inferReportFormats(
  plan: ReportPlan,
  layout: ReportLayoutPlan,
  pair: PdfReportPairAnalysis,
): ReportPlan {
  const scalarExpected = new Map<string, string>();
  const slots = new Map(pair.scalarSlots.map((slot) => [slot.id, slot]));
  for (const binding of layout.scalarBindings) {
    if (binding.value.kind !== 'scalar' || scalarExpected.has(binding.value.id)) continue;
    const slot = slots.get(binding.slotId);
    if (slot) scalarExpected.set(binding.value.id, slot.exampleText);
  }
  const scalars = plan.scalars.map((scalar) => {
    const expected = scalarExpected.get(scalar.id);
    if (expected === undefined) return scalar;
    const format = reconcileExampleFormat(expected, scalar.format);
    return format && JSON.stringify(format) !== JSON.stringify(scalar.format)
      ? { ...scalar, format }
      : scalar;
  });

  const groups = new Map(pair.tableGroups.map((group) => [group.id, group]));
  const tableExamples = new Map<string, Map<string, string>>();
  for (const binding of layout.tableBindings) {
    const group = groups.get(binding.groupId);
    if (!group || group.rows.length === 0) continue;
    const row = group.rows[0]!;
    const examples = tableExamples.get(binding.tableId) ?? new Map<string, string>();
    for (const column of binding.columns) {
      const expected = row.cells[column.columnIndex]?.exampleText;
      if (expected !== undefined && !examples.has(column.columnId)) examples.set(column.columnId, expected);
    }
    tableExamples.set(binding.tableId, examples);
  }
  const tables = plan.tables.map((table) => {
    if (table.kind !== 'aggregate') return table;
    const examples = tableExamples.get(table.id);
    if (!examples) return table;
    return {
      ...table,
      columns: table.columns.map((column) => {
        const expected = examples.get(column.id);
        if (expected === undefined) return column;
        const format = reconcileExampleFormat(expected, column.format);
        return format && JSON.stringify(format) !== JSON.stringify(column.format)
          ? { ...column, format }
          : column;
      }),
    };
  });
  return { ...plan, scalars, tables };
}

/**
 * A date-range slot is unambiguous when its completed-example text equals the
 * host's periodStart/periodEndInclusive pair. Repair only the common model
 * mistake of using periodYearMonth for the first half of an otherwise valid
 * range; the values remain metadata-driven for every future period.
 */
export function repairExamplePeriodExpressions(
  plan: ReportPlan,
  layout: ReportLayoutPlan,
  pair: PdfReportPairAnalysis,
  metadata: Record<string, ReportPrimitive>,
): ReportPlan {
  const start = metadata.periodStart;
  const end = metadata.periodEndInclusive;
  if (typeof start !== 'string' || typeof end !== 'string') return plan;
  const expected = normalizeReportText(`${start} ~ ${end}`);
  const slots = new Map(pair.scalarSlots.map((slot) => [slot.id, slot]));
  const periodScalarIds = new Set(
    layout.scalarBindings
      .filter((binding) => binding.value.kind === 'scalar')
      .filter((binding) => normalizeReportText(slots.get(binding.slotId)?.exampleText ?? '') === expected)
      .map((binding) => binding.value.kind === 'scalar' ? binding.value.id : ''),
  );
  const periodTextIds = new Set(
    layout.scalarBindings
      .filter((binding) => binding.value.kind === 'text')
      .filter((binding) => normalizeReportText(slots.get(binding.slotId)?.exampleText ?? '') === expected)
      .map((binding) => binding.value.kind === 'text' ? binding.value.id : ''),
  );
  if (periodScalarIds.size === 0 && periodTextIds.size === 0) return plan;

  const scalars = plan.scalars.map((scalar) => {
    if (!periodScalarIds.has(scalar.id) || scalar.expression.kind !== 'concat') return scalar;
    let hasEnd = false;
    let hasExclusiveEnd = false;
    let replaced = false;
    const values = scalar.expression.values.map((value) => {
      if (value.kind === 'field' && value.path === 'meta.periodEndInclusive') hasEnd = true;
      if (value.kind === 'field' && value.path === 'meta.periodEndExclusive') {
        hasExclusiveEnd = true;
        replaced = true;
        return { kind: 'field' as const, path: 'meta.periodEndInclusive' };
      }
      if (value.kind === 'field' && value.path === 'meta.periodYearMonth') {
        replaced = true;
        return { kind: 'field' as const, path: 'meta.periodStart' };
      }
      return value;
    });
    return (hasEnd || hasExclusiveEnd) && replaced
      ? { ...scalar, expression: { ...scalar.expression, values } } : scalar;
  });
  const texts = plan.texts.map((text) => {
    if (!periodTextIds.has(text.id) || text.kind !== 'computed') return text;
    const tokenOnly = /^\{\{\s*meta\.(?:periodLabel|periodYearMonth|periodTitleKorean)\s*\}\}$/u.test(text.template.trim());
    if (tokenOnly) return { ...text, template: '{{meta.periodStart}} ~ {{meta.periodEndInclusive}}' };
    return /\{\{\s*meta\.periodEndExclusive\s*\}\}/u.test(text.template)
      ? { ...text, template: text.template.replace(/\{\{\s*meta\.periodEndExclusive\s*\}\}/gu, '{{meta.periodEndInclusive}}') }
      : text;
  });
  return { ...plan, scalars, texts };
}

/**
 * Providers sometimes combine the connector kind and source alias in a
 * metadata token (for example `source.http-orders.path`) even though the
 * runtime contract uses the captured alias directly. Normalize only tokens
 * whose alias is present in the host capture plan; unknown aliases remain
 * untouched and are rejected by normal validation.
 */
export function repairReportMetadataReferences(
  plan: ReportPlan,
  capture: Pick<{ capturePlan: ReportSourceCapturePlan }, 'capturePlan'>,
): ReportPlan {
  const periodRepaired = repairLegacyPeriodEndAliases(plan);
  const aliases = {
    http: new Set(capture.capturePlan.http.map((source) => source.alias)),
    rdb: new Set(capture.capturePlan.rdb.map((source) => source.alias)),
  };
  const texts = periodRepaired.texts.map((text) => {
    if (text.kind !== 'computed') return text;
    const template = text.template.replace(
      /\{\{\s*meta\.source\.(http|rdb)-([^\s{}]+)\.(path|tableName|table)\s*\}\}/gu,
      (match, connector: 'http' | 'rdb', alias: string, field: 'path' | 'tableName' | 'table') => (
        aliases[connector].has(alias) ? `{{meta.source.${alias}.${field}}}` : match
      ),
    );
    return template === text.template ? text : { ...text, template };
  });
  return texts.some((text, index) => text !== periodRepaired.texts[index])
    ? { ...periodRepaired, texts }
    : periodRepaired;
}

function sourceAliasKey(alias: string): string {
  return alias.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/gu, '_').replace(/^_+|_+$/gu, '');
}

/** Normalize a provider's shorthand period-end field before execution. A
 * strict less-than bound needs the exclusive end; all other comparisons use
 * the inclusive end so contract overlap checks keep the final report day. */
function repairLegacyPeriodEndAliases<T>(value: T, comparisonOperation?: string): T {
  if (Array.isArray(value)) {
    return value.map((item) => repairLegacyPeriodEndAliases(item, comparisonOperation)) as T;
  }
  if (!value || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  const operation = record.kind === 'compare' && typeof record.operation === 'string'
    ? record.operation : comparisonOperation;
  let changed = false;
  const next: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(record)) {
    if (key === 'path' && item === 'meta.periodEnd') {
      changed = true;
      next[key] = operation === 'lt' ? 'meta.periodEndExclusive' : 'meta.periodEndInclusive';
      continue;
    }
    if (key === 'template' && typeof item === 'string') {
      const template = item.replace(/\{\{\s*meta\.periodEnd\s*\}\}/gu, '{{meta.periodEndInclusive}}');
      changed ||= template !== item;
      next[key] = template;
      continue;
    }
    const repaired = repairLegacyPeriodEndAliases(item, operation);
    changed ||= repaired !== item;
    next[key] = repaired;
  }
  return changed ? next as T : value;
}

/**
 * Models occasionally change an authorized alias's punctuation while editing
 * a plan (for example `team-roster` vs `team_roster`). Repair only a unique
 * match from the capture contract; ambiguous or invented aliases remain
 * untouched and still fail closed at validation.
 */
export function repairReportSourceAliases(
  plan: ReportPlan,
  capture: Pick<{ capturePlan: ReportSourceCapturePlan }, 'capturePlan'>,
): ReportPlan {
  const aliases = [
    ...capture.capturePlan.http.map((source) => source.alias),
    ...capture.capturePlan.rdb.map((source) => source.alias),
  ];
  const byKey = new Map<string, string>();
  const ambiguous = new Set<string>();
  for (const alias of aliases) {
    const key = sourceAliasKey(alias);
    const previous = byKey.get(key);
    if (previous && previous !== alias) {
      byKey.delete(key);
      ambiguous.add(key);
    } else if (!ambiguous.has(key)) {
      byKey.set(key, alias);
    }
  }
  const resolve = (alias: string): string => {
    if (aliases.includes(alias)) return alias;
    const key = sourceAliasKey(alias);
    return ambiguous.has(key) ? alias : (byKey.get(key) ?? alias);
  };
  const rewritePath = (path: string): string => {
    const separator = path.indexOf('.');
    if (separator <= 0) return path;
    const alias = path.slice(0, separator);
    const canonical = resolve(alias);
    return canonical === alias ? path : `${canonical}${path.slice(separator)}`;
  };
  const visit = (value: unknown, key = ''): unknown => {
    if (typeof value === 'string') {
      if (key === 'baseSource' || key === 'source') return resolve(value);
      if (key === 'path' || key === 'left' || key === 'right') return rewritePath(value);
      return value;
    }
    if (Array.isArray(value)) {
      let changed = false;
      const next = value.map((item) => {
        const rewritten = visit(item, key);
        changed ||= rewritten !== item;
        return rewritten;
      });
      return changed ? next : value;
    }
    if (!value || typeof value !== 'object') return value;
    let changed = false;
    const next: Record<string, unknown> = {};
    for (const [childKey, child] of Object.entries(value)) {
      const rewritten = visit(child, childKey);
      changed ||= rewritten !== child;
      next[childKey] = rewritten;
    }
    return changed ? next : value;
  };
  const repaired = visit(plan);
  return repaired === plan ? plan : repaired as ReportPlan;
}

/** Providers sometimes call the implicit root dataset "default". The
 * executable contract represents that dataset by an omitted reference; only
 * remove the shorthand when no real dataset with that id was declared. */
export function repairReportDatasetReferences(plan: ReportPlan): ReportPlan {
  const declared = new Set((plan.datasets ?? []).map((dataset) => dataset.id));
  if (declared.has('default')) return plan;
  const normalize = <T>(value: T): T => {
    if (!value || typeof value !== 'object' || !('dataset' in value)
      || value.dataset !== 'default') return value;
    const { dataset: _dataset, ...rest } = value as Record<string, unknown>;
    return rest as T;
  };
  const scalars = plan.scalars.map(normalize);
  const tables = plan.tables.map(normalize);
  if (scalars.every((scalar, index) => scalar === plan.scalars[index])
    && tables.every((table, index) => table === plan.tables[index])) return plan;
  return { ...plan, scalars, tables };
}

type SourceFieldCatalog = Map<string, Set<string>>;

function sourceFieldCatalog(sources: Record<string, ReportSourceSnapshot>): SourceFieldCatalog {
  return new Map(Object.entries(sources).map(([alias, snapshot]) => [
    alias,
    new Set(snapshot.rows.flatMap((row) => Object.keys(row))),
  ]));
}

/**
 * Providers often understand the business relationship but attach a joined
 * field to the fact alias (for example `orders.customer_name`). The plan
 * schema cannot disambiguate that spelling because it intentionally has no
 * access to source rows. Once the host has captured the example snapshots we
 * can repair a field only when the requested column is absent from its alias
 * and exactly one joined alias owns that column. Ambiguous or unknown paths
 * remain unchanged and still fail closed during execution.
 */
export function repairReportFieldAliases(
  plan: ReportPlan,
  sources: Record<string, ReportSourceSnapshot>,
): ReportPlan {
  const fields = sourceFieldCatalog(sources);
  const aliasesFor = (dataset: { baseSource: string; joins: Array<{ source: string }> }): string[] => (
    [...new Set([dataset.baseSource, ...dataset.joins.map((join) => join.source)])]
      .filter((alias) => fields.has(alias))
  );
  const repairPath = (path: string, aliases: string[]): string => {
    const parts = path.split('.');
    if (parts.length === 0 || parts[0] === 'meta') return path;
    const root = parts[0]!;
    const rootFields = fields.get(root);
    if (parts.length === 1) {
      const candidates = aliases.filter((alias) => fields.get(alias)?.has(path));
      return candidates.length === 1 ? `${candidates[0]}.${path}` : path;
    }
    if (!aliases.includes(root)) return path;
    let field = parts.slice(1).join('.');
    // Accept the nested spelling `base.joined.column` even when schema
    // normalization has not collapsed it yet.
    if (parts.length > 2 && fields.has(parts[1]!)
      && fields.get(parts[1]!)?.has(parts.slice(2).join('.'))) {
      return `${parts[1]}.${parts.slice(2).join('.')}`;
    }
    if (rootFields?.has(field)) return path;
    const candidates = aliases.filter((alias) => alias !== root && fields.get(alias)?.has(field));
    return candidates.length === 1 ? `${candidates[0]}.${field}` : path;
  };
  const visit = (value: unknown, aliases: string[]): unknown => {
    if (Array.isArray(value)) {
      let changed = false;
      const next = value.map((item) => {
        const repaired = visit(item, aliases);
        changed ||= repaired !== item;
        return repaired;
      });
      return changed ? next : value;
    }
    if (!isRecordValue(value)) return value;
    if (value.kind === 'field' && typeof value.path === 'string') {
      const path = repairPath(value.path, aliases);
      return path === value.path ? value : { ...value, path };
    }
    let changed = false;
    const next: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      // Join.right is evaluated against the candidate row and can be a bare
      // field name. It is deliberately handled by the join loop below.
      const repaired = visit(child, aliases);
      changed ||= repaired !== child;
      next[key] = repaired;
    }
    return changed ? next : value;
  };
  const repairDataset = <T extends { baseSource: string; joins: Array<{ source: string; left: string; right: string; where?: unknown }>; filter?: unknown }>(dataset: T): T => {
    const allAliases = aliasesFor(dataset);
    let changed = false;
    const joins = dataset.joins.map((join, index) => {
      const previousAliases = [dataset.baseSource, ...dataset.joins.slice(0, index).map((candidate) => candidate.source)]
        .filter((alias) => fields.has(alias));
      const left = repairPath(join.left, previousAliases);
      const where = join.where === undefined ? undefined : visit(join.where, [...previousAliases, join.source]);
      const next = { ...join, left, ...(where === undefined ? {} : { where }) };
      changed ||= left !== join.left || where !== join.where;
      return next;
    });
    const filter = dataset.filter === undefined ? undefined : visit(dataset.filter, allAliases);
    changed ||= filter !== dataset.filter;
    return changed ? { ...dataset, joins, ...(filter === undefined ? {} : { filter }) } as T : dataset;
  };

  const root = repairDataset(plan);
  const datasets = new Map((root.datasets ?? []).map((dataset) => [dataset.id, repairDataset(dataset)]));
  const datasetFor = (id?: string) => (id ? datasets.get(id) : root) ?? root;
  const scalars = root.scalars.map((scalar) => {
    const dataset = datasetFor(scalar.dataset);
    const aliases = aliasesFor(dataset);
    const expression = visit(scalar.expression, aliases) as ReportScalarExpression;
    return expression === scalar.expression ? scalar : { ...scalar, expression };
  });
  const tables = root.tables.map((table) => {
    if (table.kind !== 'aggregate') return table;
    const aliases = aliasesFor(datasetFor(table.dataset));
    const groupBy = visit(table.groupBy, aliases) as typeof table.groupBy;
    const filter = table.filter === undefined ? undefined : visit(table.filter, aliases) as typeof table.filter;
    const columns = visit(table.columns, aliases) as typeof table.columns;
    if (groupBy === table.groupBy && filter === table.filter && columns === table.columns) return table;
    return { ...table, groupBy, ...(filter === undefined ? {} : { filter }), columns } as typeof table;
  });
  const changedRoot = root !== plan || scalars.some((scalar, index) => scalar !== plan.scalars[index])
    || tables.some((table, index) => table !== plan.tables[index])
    || (root.datasets ?? []).some((dataset, index) => dataset !== plan.datasets?.[index]);
  if (!changedRoot) return plan;
  return { ...root, datasets: datasets.size ? [...datasets.values()] : root.datasets, scalars, tables };
}

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

function joinKey(value: unknown): string | number | boolean | undefined {
  const normalized = comparable(value);
  if (normalized === null || normalized === undefined || normalized === '') return undefined;
  return normalized;
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

/**
 * A risk table sometimes receives a fixed display label even though its
 * `having` predicate already identifies the runtime population. Turn that
 * label into a bounded case expression tied to the predicate. This preserves
 * the example exactly while preventing a copied literal from becoming the
 * reusable rule for arbitrary future groups.
 */
export function repairStaticDerivedTableLabels(plan: ReportPlan): ReportPlan {
  let changed = false;
  const tables = plan.tables.map((table) => {
    if (table.kind !== 'aggregate' || !table.having) return table;
    const columns = table.columns.map((column) => {
      if (column.value.kind !== 'derived' || column.value.expression.kind !== 'literal'
        || typeof column.value.expression.value !== 'string') return column;
      const label = column.value.expression;
      changed = true;
      return {
        ...column,
        value: {
          kind: 'derived' as const,
          expression: {
            kind: 'case' as const,
            branches: [{ when: table.having!, value: label }],
            fallback: label,
          },
        },
      };
    });
    return columns.some((column, index) => column !== table.columns[index]) ? { ...table, columns } : table;
  });
  return changed ? { ...plan, tables } : plan;
}

function renderTextTemplatePiece(
  token: string,
  result: ReportPlanResult,
  metadata: Record<string, ReportPrimitive>,
): string | undefined {
  if (token.startsWith('scalar.')) return result.scalars[token.slice('scalar.'.length)]?.display;
  if (token.startsWith('meta.')) {
    const value = metadata[token.slice('meta.'.length)];
    return value === undefined ? undefined : String(value ?? '');
  }
  const tableMatch = /^table\.([^.]+)\.rowCount$/u.exec(token);
  if (tableMatch) {
    const table = result.tables[tableMatch[1]!];
    return table ? String(table.rows.length) : undefined;
  }
  return undefined;
}

/**
 * PDF text extraction can split one sentence across several adjacent scalar
 * slots. If the model binds the same computed text to all of them, derive
 * reusable token-aligned fragments from the existing template. A fragment is
 * created only when the rendered example and every expected slot concatenate
 * exactly; numeric literal fragments are rejected rather than frozen.
 */
export function repairExampleTextFragments(
  plan: ReportPlan,
  layout: ReportLayoutPlan,
  pair: PdfReportPairAnalysis,
  result: ReportPlanResult,
  metadata: Record<string, ReportPrimitive>,
): { plan: ReportPlan; layout: ReportLayoutPlan } {
  const slots = new Map(pair.scalarSlots.map((slot, index) => [slot.id, { slot, index }]));
  const existingTextIds = new Set(plan.texts.map((text) => text.id));
  const fragments = new Map<string, Array<{ bindingSlotId: string; textId: string; text: ReportPlan['texts'][number] }>>();

  for (const text of plan.texts) {
    if (text.kind !== 'computed') continue;
    const bindings = layout.scalarBindings
      .filter((binding) => binding.value.kind === 'text' && binding.value.id === text.id)
      .map((binding) => ({ binding, location: slots.get(binding.slotId) }))
      .filter((entry): entry is { binding: ReportLayoutPlan['scalarBindings'][number]; location: { slot: PdfReportPairAnalysis['scalarSlots'][number]; index: number } } => Boolean(entry.location))
      .sort((left, right) => left.location.index - right.location.index);
    if (bindings.length < 2) continue;
    const expectedParts = bindings.map((entry) => entry.location.slot.exampleText);

    // A single computed text may need both a token-shape repair and a slot
    // split. Try host-owned metadata substitutions before giving up on the
    // boundary so a full date range can become the year-month prefix used by
    // the completed example without freezing that example value.
    const templateCandidates = new Set<string>([text.template]);
    for (const tokenMatch of text.template.matchAll(/\{\{\s*meta\.([^{}]+?)\s*\}\}/gu)) {
      const currentKey = tokenMatch[1]!.trim();
      for (const key of Object.keys(metadata)) {
        if (key === currentKey) continue;
        const escaped = currentKey.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
        templateCandidates.add(text.template.replace(
          new RegExp(`\\{\\{\\s*meta\\.${escaped}\\s*\\}\\}`, 'gu'),
          `{{meta.${key}}}`,
        ));
      }
    }

    for (const template of templateCandidates) {
      const rendered = renderComputedTextTemplate(template, result, metadata);
      if (rendered === undefined) continue;
      const pieces: Array<{ templateStart: number; templateEnd: number; renderedStart: number; renderedEnd: number; splittable: boolean }> = [];
      const tokenPattern = /\{\{\s*([^{}]+?)\s*\}\}/gu;
      let templateCursor = 0;
      let renderedCursor = 0;
      let match: RegExpExecArray | null;
      let valid = true;
      while ((match = tokenPattern.exec(template))) {
        const literal = template.slice(templateCursor, match.index);
        if (literal) {
          if (!rendered.startsWith(literal, renderedCursor)) { valid = false; break; }
          pieces.push({ templateStart: templateCursor, templateEnd: match.index,
            renderedStart: renderedCursor, renderedEnd: renderedCursor + literal.length, splittable: true });
          renderedCursor += literal.length;
        }
        const tokenValue = renderTextTemplatePiece(match[1]!.trim(), result, metadata);
        if (tokenValue === undefined || !rendered.startsWith(tokenValue, renderedCursor)) { valid = false; break; }
        pieces.push({ templateStart: match.index, templateEnd: tokenPattern.lastIndex,
          renderedStart: renderedCursor, renderedEnd: renderedCursor + tokenValue.length, splittable: false });
        renderedCursor += tokenValue.length;
        templateCursor = tokenPattern.lastIndex;
      }
      if (!valid) continue;
      const trailing = template.slice(templateCursor);
      if (trailing) {
        if (!rendered.startsWith(trailing, renderedCursor)) continue;
        pieces.push({ templateStart: templateCursor, templateEnd: template.length,
          renderedStart: renderedCursor, renderedEnd: renderedCursor + trailing.length, splittable: true });
        renderedCursor += trailing.length;
      }
      if (renderedCursor !== rendered.length) continue;
      const templateOffset = (boundary: number): number | undefined => {
        if (boundary === 0) return 0;
        if (boundary === rendered.length) return template.length;
        const piece = pieces.find((candidate) => (
          candidate.renderedStart <= boundary && boundary <= candidate.renderedEnd
        ));
        if (!piece) return undefined;
        if (boundary === piece.renderedStart) return piece.templateStart;
        if (boundary === piece.renderedEnd) return piece.templateEnd;
        return piece.splittable
          ? piece.templateStart + (boundary - piece.renderedStart)
          : undefined;
      };
      const matchExpectedPart = (cursor: number, expectedPart: string): { end: number; next: number } | undefined => {
        const escaped = expectedPart.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&').replace(/\s+/gu, '\\s+');
        const expectedMatch = new RegExp(`^${escaped}`, 'u').exec(rendered.slice(cursor));
        if (!expectedMatch) return undefined;
        const end = cursor + expectedMatch[0].length;
        let next = end;
        while (/\s/u.test(rendered[next] ?? '')) next += 1;
        return { end, next };
      };

      let renderedBoundary = 0;
      let templateStart = 0;
      const generated = bindings.map((entry, index) => {
        const part = expectedParts[index]!;
        const expectedMatch = matchExpectedPart(renderedBoundary, part);
        if (!expectedMatch) return undefined;
        renderedBoundary = expectedMatch.next;
        // Keep whitespace introduced by the PDF slot boundary out of both
        // fragments. `end` is before the optional inter-slot whitespace;
        // `next` is the cursor used to match the following slot.
        const templateEnd = templateOffset(expectedMatch.end);
        if (templateEnd === undefined) return undefined;
        const fragmentTemplate = template.slice(templateStart, templateEnd);
        const hasToken = /\{\{\s*(?:scalar|table|meta)\./u.test(fragmentTemplate);
        if (!hasToken && /\d/u.test(fragmentTemplate)) return undefined;
        const suffix = index === 0 ? 'lead' : index === bindings.length - 1 ? 'tail' : String(index + 1);
        const textId = `${text.id}-${suffix}`;
        if (existingTextIds.has(textId)) return undefined;
        templateStart = templateEnd;
        while (/\s/u.test(template[templateStart] ?? '')) templateStart += 1;
        return {
          bindingSlotId: entry.binding.slotId,
          textId,
          text: hasToken
            ? { id: textId, kind: 'computed' as const, template: fragmentTemplate }
            : { id: textId, kind: 'invariant' as const, value: fragmentTemplate },
        };
      });
      if (renderedBoundary !== rendered.length || generated.some((fragment) => !fragment)) continue;
      fragments.set(text.id, generated as Array<{ bindingSlotId: string; textId: string; text: ReportPlan['texts'][number] }>);
      break;
    }
  }

  if (fragments.size === 0) return { plan, layout };
  const replacements = new Map([...fragments.values()].flat().map((fragment) => [fragment.bindingSlotId, fragment.textId]));
  const nextTexts = [...plan.texts, ...[...fragments.values()].flat().map((fragment) => fragment.text)];
  const nextLayout = {
    ...layout,
    scalarBindings: layout.scalarBindings.map((binding) => {
      const textId = replacements.get(binding.slotId);
      return textId ? { ...binding, value: { kind: 'text' as const, id: textId } } : binding;
    }),
  };
  return { plan: { ...plan, texts: nextTexts }, layout: nextLayout };
}

function renderComputedTextTemplate(
  template: string,
  result: ReportPlanResult,
  metadata: Record<string, ReportPrimitive>,
): string | undefined {
  let complete = true;
  const rendered = template.replace(/\{\{\s*([^{}]+?)\s*\}\}/gu, (_match, rawToken: string) => {
    const value = renderTextTemplatePiece(rawToken.trim(), result, metadata);
    if (value === undefined) complete = false;
    return value ?? '';
  });
  return complete ? rendered : undefined;
}

/**
 * A computed sentence can use a valid metadata token with the wrong display
 * shape (for example a full date range where the example shows year-month).
 * Try only host-provided metadata substitutions and keep a change when one
 * candidate reproduces the exact bound example slot; no example data is added
 * to the reusable plan.
 */
export function repairExampleTextBindings(
  plan: ReportPlan,
  layout: ReportLayoutPlan,
  pair: PdfReportPairAnalysis,
  result: ReportPlanResult,
  metadata: Record<string, ReportPrimitive>,
): { plan: ReportPlan; layout: ReportLayoutPlan } {
  const slots = new Map(pair.scalarSlots.map((slot) => [slot.id, slot]));
  const texts = plan.texts.map((text) => {
    if (text.kind !== 'computed') return text;
    const bindings = layout.scalarBindings.filter((binding) => (
      binding.value.kind === 'text' && binding.value.id === text.id
    ));
    if (bindings.length !== 1) return text;
    const slot = slots.get(bindings[0]!.slotId);
    if (!slot) return text;
    const expected = normalizeReportText(slot.exampleText);
    const tokenMatches = [...text.template.matchAll(/\{\{\s*meta\.([^{}]+?)\s*\}\}/gu)];
    if (!tokenMatches.length) return text;
    const candidates = new Map<string, string>();
    for (const match of tokenMatches) {
      const currentKey = match[1]!.trim();
      for (const key of Object.keys(metadata)) {
        if (key === currentKey) continue;
        const escaped = currentKey.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
        const candidateTemplate = text.template.replace(
          new RegExp(`\\{\\{\\s*meta\\.${escaped}\\s*\\}\\}`, 'gu'),
          `{{meta.${key}}}`,
        );
        const rendered = renderComputedTextTemplate(candidateTemplate, result, metadata);
        if (rendered !== undefined && normalizeReportText(rendered) === expected) {
          candidates.set(candidateTemplate, key);
        }
      }
    }
    if (candidates.size !== 1) return text;
    const [template] = candidates.keys();
    return template && template !== text.template ? { ...text, template } : text;
  });
  if (!texts.some((text, index) => text !== plan.texts[index])) return { plan, layout };
  return {
    plan: { ...plan, texts },
    layout,
  };
}

function layoutValueDisplay(
  value: ReportLayoutValue,
  result: ReportPlanResult,
  metadata: Record<string, ReportPrimitive>,
): string | undefined {
  if (value.kind === 'scalar') return result.scalars[value.id]?.display;
  if (value.kind === 'text') return result.texts[value.id];
  const metadataValue = metadata[value.key];
  return metadataValue === undefined ? undefined : String(metadataValue ?? '');
}

/**
 * Rebind a slot only when a host-calculated value exactly reproduces the
 * completed example text. This repairs presentation drift such as choosing
 * `periodLabel` for a date-range slot while refusing to guess when no exact
 * derived value exists.
 */
export function repairExampleScalarBindings(
  layout: ReportLayoutPlan,
  pair: PdfReportPairAnalysis,
  result: ReportPlanResult,
  metadata: Record<string, ReportPrimitive>,
): ReportLayoutPlan {
  const slots = new Map(pair.scalarSlots.map((slot) => [slot.id, slot]));
  const candidates: ReportLayoutValue[] = [
    ...Object.keys(result.scalars).sort().map((id) => ({ kind: 'scalar' as const, id })),
    ...Object.keys(result.texts).sort().map((id) => ({ kind: 'text' as const, id })),
    ...Object.keys(metadata).sort().map((key) => ({ kind: 'metadata' as const, key })),
  ];
  return {
    ...layout,
    scalarBindings: layout.scalarBindings.map((binding) => {
      const slot = slots.get(binding.slotId);
      if (!slot) return binding;
      const current = layoutValueDisplay(binding.value, result, metadata);
      const expected = normalizeReportText(slot.exampleText);
      if (current !== undefined && normalizeReportText(current) === expected) return binding;
      const matches = candidates.filter((candidate) => {
        const display = layoutValueDisplay(candidate, result, metadata);
        return display !== undefined && normalizeReportText(display) === expected;
      });
      return matches.length === 1 ? { ...binding, value: matches[0]! } : binding;
    }),
  };
}

function sourceIdentityMetadataKey(key: string): boolean {
  return /(?:source|origin|provider|system)/iu.test(key);
}

function sourceIdentityWording(value: string): boolean {
  return /(?:rest|http|api|postgres(?:ql)?|mysql|sql|crm|source|origin|provider|system|데이터|원천|연결)/iu.test(value);
}

/**
 * Source labels are stable presentation prose for a fixed capture plan, but
 * models sometimes bind a transport-oriented metadata value (for example an
 * endpoint path) to a human-written label in the completed example. Preserve
 * the exact nonnumeric source wording as an invariant only when the binding
 * is clearly source identity related. Example-only state labels become phase
 * text so the target run can still render its host-owned status value.
 */
export function repairExamplePresentationBindings(
  plan: ReportPlan,
  layout: ReportLayoutPlan,
  pair: PdfReportPairAnalysis,
  metadata: Record<string, ReportPrimitive>,
): { plan: ReportPlan; layout: ReportLayoutPlan } {
  const slots = new Map(pair.scalarSlots.map((slot) => [slot.id, slot]));
  const texts = [...plan.texts];
  const textByValue = new Map<string, ReportPlan['texts'][number]>();
  const phaseTextByValue = new Map<string, Extract<ReportPlan['texts'][number], { kind: 'phase' }>>();
  for (const text of texts) {
    if (text.kind === 'computed') continue;
    const value = text.kind === 'invariant' ? text.value : text.exampleValue;
    textByValue.set(normalizeReportText(value), text);
    if (text.kind === 'phase') phaseTextByValue.set(normalizeReportText(value), text);
  }
  const existingIds = new Set(texts.map((text) => text.id));
  let changed = false;
  const scalarBindings = layout.scalarBindings.map((binding) => {
    if (binding.value.kind !== 'metadata') return binding;
    const slot = slots.get(binding.slotId);
    if (!slot) return binding;
    const expected = normalizeReportText(slot.exampleText);
    if (!expected || /\d/u.test(expected)) {
      return binding;
    }
    const current = metadata[binding.value.key];
    if (current !== undefined && normalizeReportText(String(current ?? '')) === expected) return binding;

    // `reportStatus` is a semantic phase value (`example`/`검토 필요`), while
    // the completed PDF may show a human label such as "과거 작성 예시".
    // Preserve that label as a phase record instead of freezing it as an
    // invariant; target execution will resolve the declared metadata key.
    if (binding.value.key === 'reportStatus' && metadata.reportPhase === 'example') {
      let text = phaseTextByValue.get(expected);
      if (!text || text.targetMetadataKey !== binding.value.key) {
        const key = binding.value.key.replace(/[^a-z0-9_-]+/giu, '_');
        let id = `${key || 'phase'}-example-${binding.slotId}`;
        let suffix = 2;
        while (existingIds.has(id)) id = `${key || 'phase'}-example-${binding.slotId}-${suffix++}`;
        text = { id, kind: 'phase', exampleValue: slot.exampleText, targetMetadataKey: binding.value.key };
        texts.push(text);
        phaseTextByValue.set(expected, text);
        existingIds.add(id);
      }
      changed = true;
      return { ...binding, value: { kind: 'text' as const, id: text.id } };
    }

    if (!sourceIdentityMetadataKey(binding.value.key) && !sourceIdentityWording(expected)) return binding;
    let text = textByValue.get(expected);
    if (!text) {
      const key = binding.value.key.replace(/[^a-z0-9_-]+/giu, '_');
      let id = `${key || 'source'}-example-${binding.slotId}`;
      let suffix = 2;
      while (existingIds.has(id)) id = `${key || 'source'}-example-${binding.slotId}-${suffix++}`;
      text = { id, kind: 'invariant', value: slot.exampleText };
      texts.push(text);
      textByValue.set(expected, text);
      existingIds.add(id);
    }
    changed = true;
    return { ...binding, value: { kind: 'text' as const, id: text.id } };
  });
  return changed
    ? { plan: { ...plan, texts }, layout: { ...layout, scalarBindings } }
    : { plan, layout };
}

/**
 * Date coverage is a compact, host-computed fact that helps the model choose
 * between similarly named source timestamps without exposing source rows.
 * Only ISO date-like strings are summarized; other business fields stay out
 * of this hint and remain available through the bounded evidence requests.
 */
export function sourceDateCoverage(
  sources: Record<string, ReportSourceSnapshot>,
  period: { start: string; endInclusive: string },
): Record<string, Record<string, {
  inPeriod: number;
  totalDates: number;
  minimum: string;
  maximum: string;
}>> {
  const coverage: Record<string, Record<string, {
    inPeriod: number;
    totalDates: number;
    minimum: string;
    maximum: string;
  }>> = {};
  for (const [source, snapshot] of Object.entries(sources)) {
    const byField = new Map<string, string[]>();
    for (const row of snapshot.rows) {
      for (const [field, value] of Object.entries(row)) {
        if (typeof value !== 'string') continue;
        const date = /^(\d{4}-\d{2}-\d{2})(?:T|\s|$)/u.exec(value)?.[1];
        if (!date) continue;
        const dates = byField.get(field);
        if (dates) dates.push(date);
        else byField.set(field, [date]);
      }
    }
    const fields: Record<string, {
      inPeriod: number;
      totalDates: number;
      minimum: string;
      maximum: string;
    }> = {};
    for (const [field, dates] of byField) {
      if (dates.length === 0) continue;
      const sorted = [...new Set(dates)].sort();
      fields[field] = {
        inPeriod: dates.filter((date) => date >= period.start && date <= period.endInclusive).length,
        totalDates: dates.length,
        minimum: sorted[0]!,
        maximum: sorted.at(-1)!,
      };
    }
    if (Object.keys(fields).length > 0) coverage[source] = fields;
  }
  return coverage;
}

/**
 * Calculation inference needs the semantic examples and table shape, while
 * layout inference owns the complete slot geometry. Keeping only the first
 * and last rows prevents a large repeated table from consuming the model's
 * context on every evidence turn.
 */
export function promptCalculationPair(pair: PdfReportPairAnalysis) {
  return {
    pageCount: pair.pageCount,
    pages: pair.pages,
    scalarSlots: pair.scalarSlots.map(({ id, pageIndex, rect, exampleText }) => ({
      id, pageIndex, rect, exampleText,
    })),
    tableGroups: pair.tableGroups.map((group) => {
      const rows = sampleCalculationRows(group.rows);
      return {
        id: group.id,
        columnCount: group.columnCount,
        rowCount: group.rowCount,
        pageBounds: group.pageBounds,
        rows: rows.map((row) => ({
          index: row.index,
          pageIndex: row.pageIndex,
          y: row.y,
          cells: row.cells.map(({ id, pageIndex, rect, exampleText }) => ({
            id, pageIndex, rect, exampleText,
          })),
        })),
        ...(rows.length < group.rows.length ? { sampled: true } : {}),
      };
    }),
  };
}

export function imagesForPair(pair: PdfReportPairAnalysis, readImage: (path: string) => Uint8Array): ModelImageInput[] {
  const images: ModelImageInput[] = [];
  let totalBytes = 0;
  for (const document of ['template', 'example'] as const) {
    for (const [index, path] of pair[`${document}Images`].entries()) {
      const data = readImage(path);
      totalBytes += data.byteLength;
      if (totalBytes > 8 * 1024 * 1024) throw new Error('report_evidence_image_limit');
      images.push({ data, mimeType: 'image/png', pageIndex: index, filename: `${document}-page-${index + 1}.png` });
    }
  }
  return images;
}

export function boundedJson(value: unknown, maxChars: number): string {
  const serialized = JSON.stringify(value);
  if (serialized.length > maxChars) throw new Error('report_planning_context_too_large');
  return serialized;
}

function runtimePresentationMetadataKey(key: string): boolean {
  return /^(?:period|reportDate|httpSource|rdbSource|source\.)/u.test(key);
}

/**
 * Structured-output models frequently mark a source label or period heading as
 * invariant even though it contains a path or date. Convert only exact
 * matches to host-owned metadata tokens; an arbitrary numeric sentence still
 * fails closed in the reusable-plan validator.
 */
export function repairReportMetadataTextReferences(
  plan: ReportPlan,
  metadata: Record<string, ReportPrimitive>,
): ReportPlan {
  const candidates = Object.entries(metadata)
    .filter(([, value]) => value !== null && value !== undefined)
    .map(([key, value]) => ({ key, value: normalizeReportText(String(value)) }))
    .filter(({ value }) => value.length > 0);
  const priority = (key: string): number => (
    key === 'periodLabel' ? 0
      : key === 'periodRange' ? 1
        : key === 'reportDate' ? 2
          : key === 'httpSourceLabel' ? 3
            : key === 'rdbSourceLabel' ? 4
              : runtimePresentationMetadataKey(key) ? 10 : 20
  );
  let changed = false;
  const texts = plan.texts.map((text) => {
    if (text.kind === 'computed') return text;
    const value = text.kind === 'invariant' ? text.value : text.exampleValue;
    const keyCandidates = candidates
      .filter((candidate) => candidate.value === normalizeReportText(value))
      .filter((candidate) => /\d/u.test(value) || sourceIdentityWording(value) || runtimePresentationMetadataKey(candidate.key))
      .sort((left, right) => priority(left.key) - priority(right.key) || left.key.localeCompare(right.key));
    const key = keyCandidates[0]?.key;
    if (!key) return text;
    changed = true;
    return { id: text.id, kind: 'computed' as const, template: `{{meta.${key}}}` };
  });
  return changed ? { ...plan, texts } : plan;
}

/**
 * The completed example is authoritative for static wording. If the model
 * binds a static text id to one or more example slots, restore the exact slot
 * wording when all bound slots agree. Numeric/date content is still rejected
 * by the reusable-plan validator after this repair.
 */
export function repairStaticTextValues(
  plan: ReportPlan,
  layout: ReportLayoutPlan,
  pair: PdfReportPairAnalysis,
): ReportPlan {
  const slots = new Map(pair.scalarSlots.map((slot) => [slot.id, slot]));
  const texts = plan.texts.map((text) => {
    if (text.kind === 'computed') return text;
    const examples = layout.scalarBindings
      .filter((binding) => binding.value.kind === 'text' && binding.value.id === text.id)
      .map((binding) => slots.get(binding.slotId)?.exampleText)
      .filter((value): value is string => value !== undefined);
    if (examples.length === 0) return text;
    const expected = normalizeReportText(examples[0]!);
    if (examples.some((value) => normalizeReportText(value) !== expected)) return text;
    return text.kind === 'invariant'
      ? { ...text, value: examples[0]! }
      : { ...text, exampleValue: examples[0]! };
  });
  return { ...plan, texts };
}

/**
 * A model can reuse one invariant text id for several visually separate
 * notes. When the completed example proves that those slots contain different
 * nonnumeric prose, preserve the existing matching binding and create a
 * bounded invariant for each unmatched slot. Numeric/date slots stay
 * rejected so this repair cannot freeze report data into the plan.
 */
export function repairStaticTextBindingConflicts(
  plan: ReportPlan,
  layout: ReportLayoutPlan,
  pair: PdfReportPairAnalysis,
): { plan: ReportPlan; layout: ReportLayoutPlan } {
  const slots = new Map(pair.scalarSlots.map((slot) => [slot.id, slot]));
  const nextTexts = [...plan.texts];
  const existingIds = new Set(nextTexts.map((text) => text.id));
  let changed = false;
  const scalarBindings = layout.scalarBindings.map((binding) => {
    const value = binding.value;
    if (value.kind !== 'text') return binding;
    const text = (plan as ReportPlan).texts.find(
      (candidate: ReportPlan['texts'][number]) => candidate.id === value.id,
    );
    const slot = slots.get(binding.slotId);
    if (!slot) return binding;
    if (!text) {
      // A layout response can retain a stale text id after the calculation
      // response omitted an optional note. Recreate only exact, nonnumeric
      // example prose; unresolved data-like text remains fail-closed.
      const expected = normalizeReportText(slot.exampleText);
      if (!expected || /\d/u.test(expected)) return binding;
      const matching = nextTexts.find((candidate) => {
        if (candidate.kind === 'computed') return false;
        const candidateValue = candidate.kind === 'invariant' ? candidate.value : candidate.exampleValue;
        return normalizeReportText(candidateValue) === expected;
      });
      if (matching) {
        changed = true;
        return { ...binding, value: { kind: 'text' as const, id: matching.id } };
      }
      let id = `${value.id}-example-${binding.slotId}`;
      let suffix = 2;
      while (existingIds.has(id)) id = `${value.id}-example-${binding.slotId}-${suffix++}`;
      nextTexts.push({ id, kind: 'invariant', value: slot.exampleText });
      existingIds.add(id);
      changed = true;
      return { ...binding, value: { kind: 'text' as const, id } };
    }
    if (text.kind === 'computed') return binding;
    const actual = text.kind === 'invariant' ? text.value : text.exampleValue;
    if (normalizeReportText(actual) === normalizeReportText(slot.exampleText)) return binding;
    const matching = nextTexts.find((candidate) => {
      if (candidate.kind === 'computed') return false;
      const value = candidate.kind === 'invariant' ? candidate.value : candidate.exampleValue;
      return normalizeReportText(value) === normalizeReportText(slot.exampleText);
    });
    if (matching) {
      changed = true;
      return { ...binding, value: { kind: 'text' as const, id: matching.id } };
    }
    if (/\d/u.test(slot.exampleText)) return binding;
    let id = `${text.id}-example-${binding.slotId}`;
    let suffix = 2;
    while (existingIds.has(id)) id = `${text.id}-example-${binding.slotId}-${suffix++}`;
    nextTexts.push({ id, kind: 'invariant', value: slot.exampleText });
    existingIds.add(id);
    changed = true;
    return { ...binding, value: { kind: 'text' as const, id } };
  });
  return changed
    ? { plan: { ...plan, texts: nextTexts }, layout: { ...layout, scalarBindings } }
    : { plan, layout };
}

/**
 * Layout inference is a binding task, so an omitted binding can be repaired
 * without asking the model to guess. Only an unbound scalar slot whose
 * completed-example text exactly matches a static plan text is eligible.
 * Unknown or paraphrased text remains rejected by the presentation validator.
 */
export function repairStaticTextBindings(
  plan: ReportPlan,
  layout: ReportLayoutPlan,
  pair: PdfReportPairAnalysis,
): ReportLayoutPlan {
  const scalarBindings = [...layout.scalarBindings];
  const boundSlotIds = new Set(scalarBindings.map((binding) => binding.slotId));
  const boundTextIds = new Set(scalarBindings.flatMap((binding) => (
    binding.value.kind === 'text' ? [binding.value.id] : []
  )));
  const groups = new Map<string, Array<{ id: string }>>();

  for (const text of plan.texts) {
    if (text.kind === 'computed') continue;
    const expected = text.kind === 'invariant' ? text.value : text.exampleValue;
    const key = normalizeReportText(expected);
    const group = groups.get(key);
    if (group) group.push({ id: text.id });
    else groups.set(key, [{ id: text.id }]);
  }

  const bind = (slotId: string, textId: string): void => {
    scalarBindings.push({ slotId, value: { kind: 'text', id: textId } });
    boundSlotIds.add(slotId);
    boundTextIds.add(textId);
  };

  for (const [expected, texts] of groups) {
    const candidates = pair.scalarSlots.filter((slot) => (
      !boundSlotIds.has(slot.id) && normalizeReportText(slot.exampleText) === expected
    ));
    if (candidates.length === 0) continue;

    let candidateIndex = 0;
    for (const text of texts) {
      if (boundTextIds.has(text.id)) continue;
      const slot = candidates[candidateIndex++];
      if (!slot) break;
      bind(slot.id, text.id);
    }

    // A single static text can legitimately occupy multiple scalar slots.
    // Bind any remaining exact matches to the first text in this group.
    const fallbackTextId = texts[0]!.id;
    while (candidateIndex < candidates.length) {
      bind(candidates[candidateIndex++]!.id, fallbackTextId);
    }
  }

  return { ...layout, scalarBindings };
}

/**
 * Layout bindings are the only values that can reach the rendered PDF. Drop
 * model-declared text records that have no physical binding so an optional
 * note cannot make an otherwise valid report fail presentation validation.
 * Bound text remains subject to the strict example-derived checks below.
 */
export function pruneUnboundReportTexts(
  plan: ReportPlan,
  layout: ReportLayoutPlan,
): ReportPlan {
  const boundTextIds = new Set(layout.scalarBindings.flatMap((binding) => (
    binding.value.kind === 'text' ? [binding.value.id] : []
  )));
  return { ...plan, texts: plan.texts.filter((text) => boundTextIds.has(text.id)) };
}
