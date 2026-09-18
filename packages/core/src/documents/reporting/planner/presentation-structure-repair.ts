import type { PdfReportPairAnalysis } from '../../read/types/pdf.js';
import type { ReportLayoutPlan } from '../layout/schema.js';
import type {
  ReportFormat,
  ReportPlan,
  ReportPrimitive,
  ReportScalarExpression,
  ReportSourceSnapshot,
} from '../plan/schema.js';
import type { ReportSourceCapturePlan } from '../source/schema.js';
import { comparable, fieldPaths, isRecordValue, valueAtPath } from '../plan/value.js';
import { normalizeReportText } from '../plan/reusability.js';
import { formatFromExampleText } from './replay-repair.js';

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
